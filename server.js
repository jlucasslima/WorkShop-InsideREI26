const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const mongoose = require('mongoose');
const path = require('path');

const app = express();

// --- CONFIGURAÇÕES JÁ PRONTAS ---
// Seu Link do Banco de Dados (Com a senha 301099 já inserida):
const MONGO_URI = "mongodb+srv://admin:301099@workshopinsiderei.i3uuhb8.mongodb.net/?retryWrites=true&w=majority&appName=WorkshopInsideREI";

// Sua Chave do Mercado Pago:
const MP_ACCESS_TOKEN = "APP_USR-2074265484142019-013011-8b52e8fe3013271ea3d7eba876ed29eb-35115214";

// Seu Site no Render (Sem a barra no final):
const MEU_SITE = "https://workshop-insiderei26.onrender.com";
// --------------------------------

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Conexão com MongoDB
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Conectado ao MongoDB com Sucesso!'))
    .catch(err => console.error('❌ Erro ao conectar no MongoDB:', err));

// Modelo do Usuário (Ingresso)
const UserSchema = new mongoose.Schema({
    email: String,
    data_pagamento: { type: Date, default: Date.now },
    payment_id: String,
    status: { type: String, default: 'pending' },
    valor: Number
});
const User = mongoose.model('User', UserSchema);

// Configuração do Mercado Pago
const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

// ROTA 1: CRIAR PAGAMENTO (Preço R$ 149,00)
app.post('/process_payment', async (req, res) => {
    try {
        const { email } = req.body;
        
        // Salva usuário pendente no banco
        const newUser = await User.create({ email, valor: 149, status: 'pending' });

        // Cria preferência de pagamento
        const preference = new Preference(client);
        const result = await preference.create({
            body: {
                items: [{
                    title: 'Workshop InsideREI26 - Ingresso Presencial',
                    quantity: 1,
                    unit_price: 149,
                    currency_id: 'BRL',
                }],
                payer: { email: email },
                external_reference: newUser._id.toString(),
                back_urls: {
                    success: `${MEU_SITE}/dashboard.html`,
                    failure: `${MEU_SITE}/`,
                    pending: `${MEU_SITE}/`
                },
                auto_return: 'approved',
                notification_url: `${MEU_SITE}/webhook`
            }
        });

        res.json({ id: result.id, init_point: result.init_point });
    } catch (error) {
        console.error(error);
        res.status(500).send("Erro ao gerar pagamento");
    }
});

// ROTA 2: WEBHOOK (Aprova o pagamento automaticamente)
app.post('/webhook', async (req, res) => {
    const { action, data } = req.body;
    
    if (action === 'payment.created' || action === 'payment.updated') {
        try {
            const payment = new Payment(client);
            const paymentInfo = await payment.get({ id: data.id });
            
            if (paymentInfo.status === 'approved') {
                await User.findByIdAndUpdate(paymentInfo.external_reference, { 
                    status: 'approved', 
                    payment_id: data.id 
                });
                console.log(`✅ Pagamento APROVADO para: ${paymentInfo.external_reference}`);
            }
        } catch (error) {
            console.error("Erro no Webhook:", error);
        }
    }
    res.sendStatus(200);
});

// ROTA 3: PAINEL ADMIN (Lista de Inscritos)
app.get('/users', async (req, res) => {
    try {
        const users = await User.find().sort({ data_pagamento: -1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar usuários' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
