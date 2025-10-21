// ============================================
// IMPORTS
// ============================================
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Client, GatewayIntentBits, EmbedBuilder, ChannelType } = require('discord.js');
require('dotenv').config();

// ============================================
// KONFIGURACJA
// ============================================
const app = express();
const PORT = process.env.PORT || 3000;

// Discord Bot Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json());

// Logowanie requestów
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ============================================
// BOT EVENTS
// ============================================
client.once('ready', () => {
    console.log('✅ Bot Discord zalogowany!');
    console.log(`📛 Zalogowany jako: ${client.user.tag}`);
    console.log(`🌐 Na ${client.guilds.cache.size} serwerach`);
    console.log('================================');
    
    // Wyświetl serwery na których jest bot
    client.guilds.cache.forEach(guild => {
        console.log(`   - ${guild.name} (ID: ${guild.id})`);
    });
    console.log('================================');
});

client.on('error', error => {
    console.error('❌ Błąd Discord bota:', error);
});

// Logowanie gdy bot dołącza do serwera
client.on('guildCreate', guild => {
    console.log(`✅ Bot dołączył do nowego serwera: ${guild.name}`);
});

// ============================================
// API ROUTES
// ============================================

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        bot: client.user ? {
            username: client.user.tag,
            id: client.user.id,
            servers: client.guilds.cache.size
        } : 'offline',
        version: '1.0.0'
    });
});

// ============================================
// OAUTH2 - Wymiana kodu na token
// ============================================
app.post('/auth/token', async (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ 
            error: 'Brak kodu autoryzacyjnego' 
        });
    }
    
    try {
        console.log('🔐 Wymiana kodu OAuth2 na token...');
        
        const response = await axios.post(
            'https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: process.env.REDIRECT_URI
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        console.log('✅ Token otrzymany pomyślnie');
        res.json(response.data);
        
    } catch (error) {
        console.error('❌ Błąd wymiany tokenu:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Błąd autoryzacji Discord',
            details: error.response?.data || error.message
        });
    }
});

// ============================================
// Pobierz serwery użytkownika
// ============================================
app.get('/guilds', async (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            error: 'Brak tokenu autoryzacyjnego' 
        });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
        console.log('📋 Pobieranie serwerów użytkownika...');
        
        // Pobierz serwery użytkownika z Discord API
        const response = await axios.get(
            'https://discord.com/api/users/@me/guilds',
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );
        
        const userGuilds = response.data;
        const botGuildIds = client.guilds.cache.map(g => g.id);
        
        // Filtruj tylko serwery gdzie:
        // 1. Bot jest obecny
        // 2. Użytkownik ma uprawnienia administratora
        const filteredGuilds = userGuilds.filter(guild => {
            const isAdmin = (guild.permissions & 0x8) === 0x8;
            const botPresent = botGuildIds.includes(guild.id);
            return isAdmin && botPresent;
        });
        
        console.log(`✅ Znaleziono ${filteredGuilds.length} dostępnych serwerów`);
        
        res.json(filteredGuilds);
        
    } catch (error) {
        console.error('❌ Błąd pobierania serwerów:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Błąd pobierania serwerów',
            details: error.response?.data || error.message
        });
    }
});

// ============================================
// Pobierz kanały serwera
// ============================================
app.get('/guilds/:guildId/channels', async (req, res) => {
    const { guildId } = req.params;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            error: 'Brak tokenu autoryzacyjnego' 
        });
    }
    
    try {
        console.log(`📋 Pobieranie kanałów dla serwera ${guildId}...`);
        
        const guild = client.guilds.cache.get(guildId);
        
        if (!guild) {
            return res.status(404).json({ 
                error: 'Bot nie jest na tym serwerze',
                hint: 'Upewnij się, że bot został dodany do tego serwera'
            });
        }
        
        // Pobierz tylko kanały tekstowe
        const textChannels = guild.channels.cache
            .filter(channel => channel.type === ChannelType.GuildText)
            .map(channel => ({
                id: channel.id,
                name: channel.name,
                type: channel.type,
                position: channel.position
            }))
            .sort((a, b) => a.position - b.position);
        
        console.log(`✅ Znaleziono ${textChannels.length} kanałów tekstowych`);
        
        res.json(textChannels);
        
    } catch (error) {
        console.error('❌ Błąd pobierania kanałów:', error.message);
        res.status(500).json({ 
            error: 'Błąd pobierania kanałów',
            details: error.message
        });
    }
});

// ============================================
// Wyślij embed na kanał
// ============================================
app.post('/send-embed', async (req, res) => {
    const { channelId, embed } = req.body;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            error: 'Brak tokenu autoryzacyjnego' 
        });
    }
    
    if (!channelId || !embed) {
        return res.status(400).json({ 
            error: 'Brak wymaganych danych (channelId, embed)' 
        });
    }
    
    try {
        console.log(`📤 Wysyłanie embeda na kanał ${channelId}...`);
        
        // Pobierz kanał
        const channel = client.channels.cache.get(channelId);
        
        if (!channel) {
            return res.status(404).json({ 
                error: 'Kanał nie znaleziony',
                hint: 'Upewnij się, że bot ma dostęp do tego kanału'
            });
        }
        
        // Sprawdź uprawnienia bota
        if (!channel.permissionsFor(client.user).has(['SendMessages', 'EmbedLinks'])) {
            return res.status(403).json({ 
                error: 'Bot nie ma uprawnień do wysyłania wiadomości lub embedów na tym kanale'
            });
        }
        
        // Zweryfikuj użytkownika
        const token = authHeader.split(' ')[1];
        const userResponse = await axios.get(
            'https://discord.com/api/users/@me/guilds',
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );
        
        const hasAccess = userResponse.data.some(guild => guild.id === channel.guild.id);
        
        if (!hasAccess) {
            return res.status(403).json({ 
                error: 'Nie masz dostępu do tego serwera' 
            });
        }
        
        // Stwórz Discord embed
        const discordEmbed = new EmbedBuilder()
            .setColor(embed.color || 0x9b59b6)
            .setTimestamp();
        
        if (embed.title) discordEmbed.setTitle(embed.title);
        if (embed.description) discordEmbed.setDescription(embed.description);
        if (embed.thumbnail?.url) discordEmbed.setThumbnail(embed.thumbnail.url);
        if (embed.image?.url) discordEmbed.setImage(embed.image.url);
        
        if (embed.author?.name) {
            discordEmbed.setAuthor({
                name: embed.author.name,
                iconURL: embed.author.icon_url
            });
        }
        
        if (embed.footer?.text) {
            discordEmbed.setFooter({
                text: embed.footer.text,
                iconURL: embed.footer.icon_url
            });
        }
        
        // Wyślij embed
        await channel.send({ embeds: [discordEmbed] });
        
        console.log(`✅ Embed wysłany pomyślnie na kanał #${channel.name}`);
        
        res.json({ 
            success: true, 
            message: 'Embed wysłany pomyślnie!',
            channel: {
                id: channel.id,
                name: channel.name
            }
        });
        
    } catch (error) {
        console.error('❌ Błąd wysyłania embeda:', error.message);
        res.status(500).json({ 
            error: 'Błąd wysyłania embeda',
            details: error.message
        });
    }
});

// ============================================
// Error handling
// ============================================
app.use((err, req, res, next) => {
    console.error('❌ Nieobsłużony błąd:', err);
    res.status(500).json({ 
        error: 'Wewnętrzny błąd serwera',
        details: err.message
    });
});

// ============================================
// START SERWERA
// ============================================

// Najpierw zaloguj bota
client.login(process.env.BOT_TOKEN)
    .then(() => {
        // Następnie uruchom serwer HTTP
        app.listen(PORT, () => {
            console.log('================================');
            console.log(`🚀 Serwer API uruchomiony!`);
            console.log(`📡 Port: ${PORT}`);
            console.log(`🌐 URL: http://localhost:${PORT}`);
            console.log('================================');
        });
    })
    .catch(error => {
        console.error('❌ Błąd logowania bota:', error);
        process.exit(1);
    });

// Obsługa zamykania
process.on('SIGINT', () => {
    console.log('\n👋 Zamykanie bota...');
    client.destroy();
    process.exit(0);
});
