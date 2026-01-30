require('dotenv').config(); // Opcional, mas bom ter
const express = require('express');
const mongoose = require('mongoose'); // Importante: O driver do Banco
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname)));

// --- 1. COLE AQUI A STRING DO MONGODB ---
// Apague o texto entre aspas e cole o seu link (lembre de trocar a senha no link!)
const MONGO_URI = 'mongodb+srv://admin:301099@workshopinsiderei.i3uuhb8.mongodb.net/?appName=WorkshopInsideREI';

// Conexão com o Banco na Nuvem
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Conectado ao MongoDB!"))
    .catch(err => console.error("Erro ao conectar no Mongo:", err));


// --- 2. CONFIGURAÇÃO MERCADO PAGO ---
const client = new MercadoPagoConfig({ 
    accessToken: 'APP_USR-2074265484142019-013011-8b52e8fe3013271ea3d7eba876ed29eb-35115214' 
});


// --- 3. MODELO DE DADOS (Como o usuário é salvo) ---
const userSchema = new mongoose.Schema({
    nome: String,
    email: { type: String, unique: true },
    senha: String,
    telefone: String,
    ticket: {
        status: String,
        hash: String,
        date: String,
        used: { type: Boolean, default: false },
        checkin_date: String
    }
});
const User = mongoose.model('User', userSchema);


// --- 4. FUNÇÃO PARA GERAR CÓDIGO DO INGRESSO ---
async function gerarProximoCodigo() {
    // Conta quantos ingressos aprovados existem no banco
    const total = await User.countDocuments({ 'ticket.status': 'approved' });
    return String(total + 1).padStart(3, '0');
}


// --- ROTAS DO SITE ---

// Cadastro
app.post('/register', async (req, res) => {
    try {
        const { nome, email, senha, telefone } = req.body;
        
        // Verifica se já existe no banco
        const existe = await User.findOne({ email });
        if (existe) return res.status(400).json({ error: 'E-mail já cadastrado!' });

        const newUser = new User({ nome, email, senha, telefone, ticket: null });
        await newUser.save(); // Salva na nuvem
        
        res.json({ message: 'Cadastro realizado!', userId: newUser._id, nome: newUser.nome });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: 'Erro ao cadastrar' }); 
    }
});

// Login
app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    const user = await User.findOne({ email, senha });
    if (user) {
        res.json({ message: 'Logado!', userId: user._id, nome: user.nome, email: user.email });
    } else {
        res.status(401).json({ error: 'E-mail ou senha incorretos' });
    }
});

// Meus Dados
app.get('/me/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (user) res.json(user); else res.status(404).json({ error: 'Usuário não encontrado' });
    } catch (e) { res.status(404).json({ error: 'ID inválido' }); }
});


// --- PAGAMENTO (Checkout Pro) ---
app.post('/process_payment', async (req, res) => {
    try {
        const { userId, preco } = req.body;
        const user = await User.findById(userId);

        if (!user) return res.status(404).send("Usuário não encontrado");

        // Define a URL do site (Se estiver no Render usa a URL dele, se não, localhost)
        const SITE_URL = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';

        const preference = new Preference(client);
        
        const result = await preference.create({
            body: {
                items: [
                    {
                        title: 'Workshop InsideREI26', // Nome atualizado
                        quantity: 1,
                        unit_price: Number(preco),
                        currency_id: 'BRL',
                    }
                ],
                payer: {
                    email: user.email,
                    name: user.nome
                },
                external_reference: String(user._id), // Guarda o ID do banco
                
                back_urls: {
                    success: `${SITE_URL}/dashboard.html`,
                    failure: `${SITE_URL}/dashboard.html`,
                    pending: `${SITE_URL}/dashboard.html`
                },
                // auto_return: 'approved', // Comentado para evitar erro local
                
                // Webhook automático
                notification_url: `${SITE_URL}/webhook`
            }
        });

        res.json({ link: result.init_point });

    } catch (error) {
        console.error("ERRO MERCADO PAGO:", error);
        res.status(500).send('Erro ao gerar link de pagamento');
    }
});


// --- WEBHOOK (Confirmação Automática) ---
app.post('/webhook', async (req, res) => {
    const { query } = req;
    
    // Se for notificação de pagamento
    if (query.topic === 'payment' || query.type === 'payment') {
        const paymentId = query.id || query['data.id'];
        
        try {
            const payment = new Payment(client);
            const paymentData = await payment.get({ id: paymentId });

            if (paymentData.status === 'approved') {
                const userId = paymentData.external_reference;
                const user = await User.findById(userId);

                // Se achou o usuário e ele ainda não tem ingresso
                if (user && (!user.ticket || user.ticket.status !== 'approved')) {
                    const novoCodigo = await gerarProximoCodigo();
                    
                    user.ticket = { 
                        status: 'approved', 
                        hash: novoCodigo, 
                        date: new Date().toISOString(), 
                        used: false 
                    };
                    await user.save();
                    console.log(`✅ Ingresso liberado para: ${user.nome}`);
                }
            }
        } catch (error) {
            console.log("Erro no webhook:", error);
        }
    }
    res.status(200).send('OK');
});


// --- ADMINISTRAÇÃO (Lista de Usuários) ---
app.get('/admin/users', async (req, res) => {
    // Busca todos que têm ticket aprovado
    const users = await User.find({ 'ticket.status': 'approved' });
    
    // Formata para o admin.html ler (converte _id para id)
    const formatado = users.map(u => ({
        id: u._id,
        nome: u.nome,
        email: u.email,
        telefone: u.telefone,
        ticket: u.ticket
    }));
    
    res.json(formatado);
});

// Check-in na Portaria
app.post('/admin/toggle-checkin/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (user) {
            const novoStatus = !user.ticket.used;
            user.ticket.used = novoStatus;
            user.ticket.checkin_date = novoStatus ? new Date().toISOString() : null;
            
            await user.save();
            res.json({ success: true, used: novoStatus });
        } else {
            res.status(404).send('Usuário não encontrado');
        }
    } catch (e) { res.status(500).send('Erro no servidor'); }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Rodando na porta ${PORT}`));

// Versão Final Agora Vai 2.0

