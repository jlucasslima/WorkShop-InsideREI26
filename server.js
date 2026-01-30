const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const mongoose = require('mongoose');
const path = require('path');

const app = express();

// --- SUAS CREDENCIAIS ---
const MONGO_URI = "mongodb+srv://admin:301099@workshopinsiderei.i3uuhb8.mongodb.net/?retryWrites=true&w=majority&appName=WorkshopInsideREI";
const MP_ACCESS_TOKEN = "APP_USR-2074265484142019-013011-8b52e8fe3013271ea3d7eba876ed29eb-35115214";
const MEU_SITE = "https://workshop-insiderei26.onrender.com"; 

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Conectado!'))
    .catch(err => console.error('❌ Erro MongoDB:', err));

const UserSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true },
    telefone: String,
    data_pagamento: { type: Date, default: Date.now },
    payment_id: String,
    ticket: {
        status: { type: String, default: 'pending' },
        hash: { type: String, default: 'PENDENTE' },
        used: { type: Boolean, default: false }
    },
    valor: Number
});
const User = mongoose.model('User', UserSchema);

const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

// --- ROTA DE REGISTRO ---
app.post('/register', async (req, res) => {
    try {
        const { nome, email, senha, telefone } = req.body;
        const userExists = await User.findOne({ email });
        if (userExists) return res.status(400).json({ error: "E-mail já cadastrado!" });

        const newUser = await User.create({
            nome, email, senha, telefone,
            valor: 0,
            ticket: { status: 'pending', hash: 'AGUARDANDO', used: false }
        });

        res.json({ success: true, userId: newUser._id, nome: newUser.nome, email: newUser.email });
    } catch (error) { res.status(500).json({ error: "Erro ao criar conta" }); }
});

// --- ROTA DE LOGIN ---
app.post('/login', async (req, res) => {
    try {
        const { email, senha } = req.body;
        const user = await User.findOne({ email });
        if (!user || user.senha !== senha) return res.status(401).json({ error: "Dados incorretos" });

        res.json({ success: true, userId: user._id, nome: user.nome, email: user.email });
    } catch (error) { res.status(500).json({ error: "Erro no servidor" }); }
});

// --- ROTA DO DASHBOARD (A QUE ESTAVA FALTANDO!) ---
app.get('/my-ticket', async (req, res) => {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: "Email necessário" });
    
    const user = await User.findOne({ email: email });
    if (user) res.json(user);
    else res.status(404).json({ error: "Usuário não encontrado" });
});

// --- PAGAMENTO ---
app.post('/process_payment', async (req, res) => {
    try {
        const { email } = req.body;
        let user = await User.findOne({ email });
        
        // Se o usuário não existir (compra sem login), cria um temporário
        if (!user) {
            user = await User.create({ email, nome: 'Visitante', senha: 'pix', valor: 149 });
        }

        const preference = new Preference(client);
        const result = await preference.create({
            body: {
                items: [{ title: 'Workshop InsideREI26', quantity: 1, unit_price: 149, currency_id: 'BRL' }],
                payer: { email: email },
                external_reference: user._id.toString(),
                back_urls: {
                    success: `${MEU_SITE}/dashboard.html`,
                    failure: `${MEU_SITE}/dashboard.html`,
                    pending: `${MEU_SITE}/dashboard.html`
                },
                auto_return: 'approved',
                notification_url: `${MEU_SITE}/webhook`
            }
        });
        res.json({ id: result.id, init_point: result.init_point });
    } catch (error) { res.status(500).send("Erro no pagamento"); }
});

// --- WEBHOOK ---
app.post('/webhook', async (req, res) => {
    const { action, data } = req.body;
    if (action === 'payment.created' || action === 'payment.updated') {
        try {
            const payment = new Payment(client);
            const info = await payment.get({ id: data.id });
            if (info.status === 'approved') {
                const codigoVIP = "VIP-" + Math.random().toString(36).substr(2, 6).toUpperCase();
                await User.findByIdAndUpdate(info.external_reference, { 
                    'ticket.status': 'approved',
                    'ticket.hash': codigoVIP,
                    payment_id: data.id,
                    valor: 149
                });
            }
        } catch (e) { console.error(e); }
    }
    res.sendStatus(200);
});

// --- ADMIN ---
app.get('/admin/users', async (req, res) => {
    const users = await User.find().sort({ data_pagamento: -1 });
    res.json(users);
});
app.get('/users', async (req, res) => {
    const users = await User.find().sort({ data_pagamento: -1 });
    res.json(users);
});
app.post('/admin/toggle-checkin/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (user) {
            user.ticket.used = !user.ticket.used;
            await user.save();
        }
        res.json({ success: true });
    } catch (e) { res.status(500).send('Erro'); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Rodando na porta ${PORT}`));
