require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const mongoose = require('mongoose');
const path = require('path');

const app = express();

// Configurações básicas
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname))); // Serve seus arquivos HTML/CSS atuais

// Conexão MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Conectado!'))
    .catch(err => console.error('❌ Erro MongoDB:', err));

// Modelo do Usuário (Seus dados)
const UserSchema = new mongoose.Schema({
    email: String,
    data_pagamento: { type: Date, default: Date.now },
    payment_id: String,
    status: { type: String, default: 'pending' },
    valor: Number
});
const User = mongoose.model('User', UserSchema);

// Mercado Pago Config
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

// 1. ROTA DE PAGAMENTO (Fixa o preço em 149)
app.post('/process_payment', async (req, res) => {
    try {
        const { email } = req.body;
        
        // Cria usuário pendente
        const newUser = await User.create({ 
            email, 
            valor: 149.00, // Forçando o valor correto aqui
            status: 'pending' 
        });

        // Cria preferência no Mercado Pago
        const preference = new Preference(client);
        const result = await preference.create({
            body: {
                items: [{
                    title: 'Workshop InsideREI26 - SP',
                    quantity: 1,
                    unit_price: 149.00, // Valor real
                    currency_id: 'BRL',
                }],
                payer: { email: email },
                external_reference: newUser._id.toString(), // ID para o Webhook achar depois
                back_urls: {
                    success: `${process.env.RENDER_EXTERNAL_URL}/dashboard.html`, // Manda pro painel ou sucesso
                    failure: `${process.env.RENDER_EXTERNAL_URL}/`,
                    pending: `${process.env.RENDER_EXTERNAL_URL}/`
                },
                auto_return: 'approved',
                notification_url: `${process.env.RENDER_EXTERNAL_URL}/webhook`
            }
        });

        res.json({ id: result.id, init_point: result.init_point });
    } catch (error) {
        console.error(error);
        res.status(500).send("Erro ao processar");
    }
});

// 2. ROTA DO WEBHOOK (Aprova o pagamento)
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
                console.log(`✅ Pagamento aprovado para: ${paymentInfo.external_reference}`);
            }
        } catch (error) {
            console.error("Erro webhook:", error);
        }
    }
    res.sendStatus(200);
});

// 3. ROTA DO PAINEL ADMIN (Para carregar a lista)
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
