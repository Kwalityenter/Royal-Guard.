const { 
    Client, 
    GatewayIntentBits, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ChannelType, 
    REST, 
    Routes, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder, 
    PermissionsBitField 
} = require('discord.js');
const { request } = require('undici');
const fs = require('fs');
const path = require('path');
const http = require('http');

// --- RAILWAY HEALTH CHECK SERVER ---
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is online');
}).listen(process.env.PORT || 3000, () => {
    console.log(`Health check backend listening on port ${process.env.PORT || 3000}`);
});

const CONFIG_FILE = './config.json';
let config = {};

if (fs.existsSync(CONFIG_FILE)) {
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) {}
}

const TOKEN = process.env.TOKEN || config.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || config.CLIENT_ID;
const VERIFIED_ROLE_NAME = process.env.VERIFIED_ROLE_NAME || config.VERIFIED_ROLE_NAME || "Verified";
const PROTECTED_USERS = config.QUARANTINE_PROTECTED_IDS || [];
const OWNER_ID = "1151872484937834496"; // Change this to your numeric Discord ID

if (!TOKEN) {
    console.error("Missing token.");
    process.exit(1);
}

const EMBED_BRANDING = {
    authorName: 'germanarmyholder.',        
    authorIcon: 'https://i.imgur.com/YourImageLink.png', 
    groupName: 'BRITISH ARMY',              
    primaryColor: '#5DADE2',                
    errorColor: '#E67E22'                   
};

const BMT_CONFIG = {
    targetRankValue: 2, 
    requiredCorrect: 4, 
    questions: [
        { q: "Is advertising outside groups allowed in BA?", a: ["no"] },
        { q: "Who is current Field Marshal of BA?", a: ["gutalidarsh"] },
        { q: "Can you troll inside Belfast Garrison?", a: ["no"] },
        { q: "Can you random kill people inside Belfast Garrison?", a: ["no"] },
        { q: "Who is responsible for handling decorum inside Belfast Garrison?", a: ["royal military police", "rmp"] }
    ]
};

let slashCommandsData = [];
const commandsPath = path.join(__dirname, 'commands.js');
if (fs.existsSync(commandsPath)) {
    try {
        slashCommandsData = require(commandsPath);
    } catch (err) {}
}

const DB_FILE = './database.json';
let db = {};
if (!fs.existsSync(DB_FILE)) {
    try { fs.writeFileSync(DB_FILE, JSON.stringify({ licensedGuilds: [] }, null, 2), 'utf8'); } catch (e) {}
} else {
    try {
        const content = fs.readFileSync(DB_FILE, 'utf8').trim();
        db = content ? JSON.parse(content) : {};
    } catch { db = { licensedGuilds: [] }; }
}

if (!db.licensedGuilds) db.licensedGuilds = [];

function saveDB() {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) {}
}

const activeSessions = new Map();
const bmtSessions = new Map(); 
const cooldowns = new Map();

const randomWords = ["apple", "banana", "robot", "blue", "army", "up", "down", "left", "right", "yes", "no", "green", "tiger", "shadow", "alpha", "delta", "verification", "cheese"];
function generateVerificationCode() {
    let shuffled = randomWords.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 6).join(" ");
}

function getAdminLevel(guild, member) {
    if (guild.ownerId === member.id) return 8; 
    const serverConfig = db[guild.id];
    if (!serverConfig) return 0;
    let highestLevel = 0;
    if (serverConfig.adminUsers && serverConfig.adminUsers[member.id]) {
        highestLevel = Math.max(highestLevel, serverConfig.adminUsers[member.id]);
    }
    if (serverConfig.adminRoles) {
        for (const [roleId, level] of Object.entries(serverConfig.adminRoles)) {
            if (member.roles.cache.has(roleId)) {
                highestLevel = Math.max(highestLevel, serverConfig.adminRoles[roleId]);
            }
        }
    }
    if (highestLevel === 0 && member.permissions.has(PermissionFlagsBits.Administrator)) {
        return 1; 
    }
    return highestLevel;
}

async function sendLog(guild, type, embed) {
    const serverConfig = db[guild.id];
    if (!serverConfig || !serverConfig.logChannels || !serverConfig.logChannels[type]) return;
    const channel = guild.channels.cache.get(serverConfig.logChannels[type]);
    if (channel) {
        await channel.send({ embeds: [embed] }).catch(() => {});
    }
}

async function getRobloxUser(username) {
    try {
        const res = await request('https://users.roblox.com/v1/usernames/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
        });
        const data = await res.body.json();
        if (data.data && data.data.length > 0) {
            const user = data.data[0];
            const pRes = await request(`https://users.roblox.com/v1/users/${user.id}`);
            const pData = await pRes.body.json();
            return { id: user.id, username: user.requestedUsername || user.name, description: pData.description || "", created: pData.created };
        }
    } catch (e) {}
    return null;
}

async function getRobloxUserById(userId) {
    try {
        const res = await request(`https://users.roblox.com/v1/users/${userId}`);
        const data = await res.body.json();
        if (data && data.id) {
            return { id: data.id, username: data.name, description: data.description || "", created: data.created };
        }
    } catch (e) {}
    return null;
}

async function getRobloxUserRank(userId, groupId) {
    try {
        const res = await request(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
        const data = await res.body.json();
        if (data && data.data) {
            const group = data.data.find(g => g.group.id === parseInt(groupId, 10));
            return group ? group.role.rank : 0; 
        }
    } catch (e) {}
    return 0;
}

async function getRobloxFullGroupInfo(userId, groupId) {
    try {
        const res = await request(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
        const data = await res.body.json();
        if (data && data.data) {
            const group = data.data.find(g => g.group.id === parseInt(groupId, 10));
            if (group) return { name: group.role.name, rank: group.role.rank };
        }
    } catch (e) {}
    return { name: "Guest / Non-member", rank: 0 };
}

async function getRobloxUserHistory(userId) {
    try {
        const res = await request(`https://users.roblox.com/v1/users/${userId}/username-history?limit=10&sortOrder=Desc`);
        const data = await res.body.json();
        if (data && data.data && data.data.length > 0) {
            return data.data.map(u => u.name).join(', ');
        }
    } catch (e) {}
    return "None";
}

async function changeRobloxRank(guildId, robloxUserId, targetRankValue) {
    const serverConfig = db[guildId];
    if (!serverConfig || !serverConfig.robloxCookie || !serverConfig.groupId) {
        throw new Error("Roblox credentials missing from configuration.");
    }

    const rolesRes = await request(`https://groups.roblox.com/v1/groups/${serverConfig.groupId}/roles`);
    const rolesData = await rolesRes.body.json();
    const targetRole = rolesData.roles.find(r => r.rank === parseInt(targetRankValue, 10));
    
    if (!targetRole) throw new Error(`Rank not found: ${targetRankValue}`);

    const csrfRes = await request('https://auth.roblox.com/v2/logout', {
        method: 'POST',
        headers: { 'Cookie': `.ROBLOSECURITY=${serverConfig.robloxCookie}` }
    });
    const xCsrfToken = csrfRes.headers['x-csrf-token'];

    const patchRes = await request(`https://groups.roblox.com/v1/groups/${serverConfig.groupId}/users/${robloxUserId}`, {
        method: 'PATCH',
        headers: {
            'Cookie': `.ROBLOSECURITY=${serverConfig.robloxCookie}`,
            'X-CSRF-TOKEN': xCsrfToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ roleId: targetRole.id })
    });

    if (patchRes.statusCode !== 200) {
        throw new Error(`Roblox API Error: ${patchRes.statusCode}`);
    }
    return targetRole.name;
}

async function executeUserUpdate(interaction, member, serverConfig, explicitUserId = null) {
    let robloxUser = null;
    if (explicitUserId) {
        robloxUser = await getRobloxUserById(explicitUserId);
    } else if (db.globalVerifiedUsers && db.globalVerifiedUsers[member.id]) {
        robloxUser = await getRobloxUserById(db.globalVerifiedUsers[member.id]);
    }
    
    if (!robloxUser) {
        robloxUser = await getRobloxUser((member.nickname || member.user.username).replace(/^\[[^\]]+\]\s*/, '').trim());
    }
    
    if (!robloxUser) {
        const errEmbed = new EmbedBuilder().setDescription("Could not locate your Roblox profile.").setColor(EMBED_BRANDING.errorColor);
        if (interaction && interaction.editReply && (interaction.deferred || interaction.replied)) {
            return interaction.editReply({ embeds: [errEmbed] });
        }
        return interaction && interaction.channel ? interaction.channel.send({ embeds: [errEmbed] }) : null;
    }

    if (!db.globalVerifiedUsers) db.globalVerifiedUsers = {};
    db.globalVerifiedUsers[member.id] = robloxUser.id;
    saveDB();

    if (!serverConfig.groupId) {
        const errEmbed = new EmbedBuilder().setDescription("Roblox Group ID is missing.").setColor(EMBED_BRANDING.errorColor);
        if (interaction && interaction.editReply && (interaction.deferred || interaction.replied)) {
            return interaction.editReply({ embeds: [errEmbed] });
        }
        return interaction && interaction.channel ? interaction.channel.send({ embeds: [errEmbed] }) : null;
    }

    const rankValue = await getRobloxUserRank(robloxUser.id, serverConfig.groupId);
    
    const targetRoleIds = new Set();
    const allManagedRoles = new Set();
    let selectedPrefix = "None";
    let highestPrefixWeight = -1;

    if (serverConfig.binds && Array.isArray(serverConfig.binds)) {
        for (const bind of serverConfig.binds) {
            if (bind.roleIds) bind.roleIds.forEach(id => allManagedRoles.add(id));
            if (bind.roleId) allManagedRoles.add(bind.roleId);

            let matches = false;
            const comp = bind.compare || '==';
            const targetRank = parseInt(bind.rank, 10);

            if (comp === '==' && rankValue === targetRank) matches = true;
            else if (comp === '>=' && rankValue >= targetRank) matches = true;
            else if (comp === '<=' && rankValue <= targetRank) matches = true;
            else if (comp === '>' && rankValue > targetRank) matches = true;
            else if (comp === '<' && rankValue < targetRank) matches = true;
            else if (comp === 'range' && rankValue >= parseInt(bind.minRank, 10) && rankValue <= parseInt(bind.maxRank, 10)) matches = true;

            if (matches) {
                if (bind.roleIds) bind.roleIds.forEach(id => targetRoleIds.add(id));
                if (bind.roleId) targetRoleIds.add(bind.roleId);
                
                if (bind.prefix && (comp === 'range' ? parseInt(bind.minRank, 10) : targetRank) > highestPrefixWeight) {
                    selectedPrefix = bind.prefix;
                    highestPrefixWeight = comp === 'range' ? parseInt(bind.minRank, 10) : targetRank;
                }
            }
        }
    }

    const formatPrefix = selectedPrefix !== "None" ? `[${selectedPrefix.replace(/[\[\]]/g, '')}] ` : "";
    const finalNickname = `${formatPrefix}${robloxUser.username}`.substring(0, 32);
    await member.setNickname(finalNickname).catch(() => {});
    
    const verifiedRole = member.guild.roles.cache.find(r => r.name === VERIFIED_ROLE_NAME);
    if (verifiedRole) await member.roles.add(verifiedRole).catch(() => {});

    let rolesAddedList = [];
    let rolesRemovedList = [];

    for (const rId of targetRoleIds) {
        if (!member.roles.cache.has(rId)) {
            await member.roles.add(rId).catch(() => {});
            rolesAddedList.push(`<@&${rId}>`);
        }
    }

    for (const rId of allManagedRoles) {
        if (!targetRoleIds.has(rId) && member.roles.cache.has(rId)) {
            await member.roles.remove(rId).catch(() => {});
            rolesRemovedList.push(`<@&${rId}>`);
        }
    }

    const responseEmbed = new EmbedBuilder()
        .setAuthor({ name: EMBED_BRANDING.authorName, iconURL: EMBED_BRANDING.authorIcon })
        .setTitle(`${EMBED_BRANDING.groupName} Roles System`)
        .setDescription("Updated user configurations successfully.")
        .addFields(
            { name: "Nickname", value: finalNickname, inline: false },
            { name: "Roles Added", value: rolesAddedList.length > 0 ? rolesAddedList.map(r => `• ${r}`).join('\n') : "None", inline: false },
            { name: "Roles Removed", value: rolesRemovedList.length > 0 ? rolesRemovedList.map(r => `• ${r}`).join('\n') : "None", inline: false }
        )
        .setColor(EMBED_BRANDING.primaryColor);
    
    if (interaction && interaction.editReply && (interaction.deferred || interaction.replied)) {
        return interaction.editReply({ embeds: [responseEmbed] });
    }
    return interaction && interaction.channel ? interaction.channel.send({ embeds: [responseEmbed] }) : null;
}

async function generateFinalTicket(interaction, channelPrefix, selectionLabel, categoryId) {
    try {
        const cleanUserSanitized = interaction.user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
        const ticketChannel = await interaction.guild.channels.create({
            name: `${channelPrefix}-${cleanUserSanitized}`,
            type: ChannelType.GuildText,
            parent: categoryId,
            permissionOverwrites: [
                { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        const closeTicketRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_close_ticket')
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger)
        );

        if (selectionLabel === 'verification') {
            const step1Embed = new EmbedBuilder()
                .setTitle("Roblox Verification")
                .setDescription(`Hello ${interaction.user},\n\nType your Roblox Username below.\n\nType \`cancel\` or click the button below to close this channel.`)
                .setFooter({ text: "Step 1 of 3" })
                .setColor(EMBED_BRANDING.primaryColor);

            await ticketChannel.send({ embeds: [step1Embed], components: [closeTicketRow] });
            activeSessions.set(ticketChannel.id, { step: 1, userId: interaction.user.id, robloxId: null, robloxUsername: null, verificationCode: "" });

            const notifyEmbed = new EmbedBuilder().setDescription(`Verification channel created: ${ticketChannel}`).setColor(EMBED_BRANDING.primaryColor);
            if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: [notifyEmbed] });
            else await interaction.reply({ embeds: [notifyEmbed], ephemeral: true });
        } else {
            const cleanTitleLabel = selectionLabel.replace(/-/g, ' ').toUpperCase();
            const supportTicketEmbed = new EmbedBuilder()
                .setTitle(`${cleanTitleLabel} Ticket`)
                .setDescription(`Hello ${interaction.user},\n\nPlease describe your issue below.\n\nType \`cancel\` or click the button below to close this channel.`)
                .setColor(EMBED_BRANDING.primaryColor);

            await ticketChannel.send({ content: `${interaction.user}`, embeds: [supportTicketEmbed], components: [closeTicketRow] });

            const standardNotifyEmbed = new EmbedBuilder().setDescription(`Ticket channel created: ${ticketChannel}`).setColor(EMBED_BRANDING.primaryColor);
            if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: [standardNotifyEmbed] });
            else await interaction.reply({ embeds: [standardNotifyEmbed], ephemeral: true });
        }

        const ticketLog = new EmbedBuilder()
            .setTitle("Ticket Created")
            .setDescription(`Ticket ${selectionLabel} opened by ${interaction.user} in ${ticketChannel}.`)
            .setColor(EMBED_BRANDING.primaryColor)
            .setTimestamp();
        await sendLog(interaction.guild, 'tickets', ticketLog);

    } catch (e) {
        const errorMsg = { embeds: [new EmbedBuilder().setDescription("Failed creating ticket channel.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true };
        if (interaction.deferred || interaction.replied) await interaction.editReply(errorMsg).catch(() => {});
        else await interaction.reply(errorMsg).catch(() => {});
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.DirectMessages
    ]
});

client.once('ready', async () => {
    console.log(`Bot running: ${client.user.tag}`);
    try {
        const restInstance = new REST({ version: '10' }).setToken(TOKEN);
        await restInstance.put(Routes.applicationCommands(CLIENT_ID), { body: slashCommandsData });
    } catch (e) {}
});

// --- RETAIN ON JOIN FLOW ---
client.on('guildCreate', async guild => {
    console.log(`Bot joined server: ${guild.name} (${guild.id})`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (!message.guild) {
        if (bmtSessions.has(message.author.id)) {
            const session = bmtSessions.get(message.author.id);
            const currentQ = BMT_CONFIG.questions[session.step];
            const answerClean = message.content.trim().toLowerCase();

            if (currentQ.a.includes(answerClean)) session.score++;
            session.step++;

            if (session.step < BMT_CONFIG.questions.length) {
                bmtSessions.set(message.author.id, session);
                return message.reply({ embeds: [
                    new EmbedBuilder()
                        .setTitle(`Question ${session.step + 1} of ${BMT_CONFIG.questions.length}`)
                        .setDescription(`**Question:** ${BMT_CONFIG.questions[session.step].q}`)
                        .setColor(EMBED_BRANDING.primaryColor)
                ]});
            } else {
                bmtSessions.delete(message.author.id);
                const passed = session.score >= BMT_CONFIG.requiredCorrect;
                
                if (passed) {
                    const targetGuild = client.guilds.cache.get(session.guildId);
                    const targetMember = await targetGuild?.members.fetch(message.author.id).catch(() => null);
                    const serverConfig = db[session.guildId];
                    const robloxUserId = db.globalVerifiedUsers?.[message.author.id];

                    try {
                        let groupRoleName = "Private";
                        if (serverConfig && robloxUserId) {
                            groupRoleName = await changeRobloxRank(session.guildId, robloxUserId, BMT_CONFIG.targetRankValue);
                            if (targetMember) await executeUserUpdate(null, targetMember, serverConfig, robloxUserId);
                        }

                        await message.reply({ embeds: [
                            new EmbedBuilder()
                                .setTitle("BMT Passed")
                                .setDescription(`Score: ${session.score}/${BMT_CONFIG.questions.length}.\n\nYou have been promoted to ${groupRoleName} and roles are updated.`)
                                .setColor(EMBED_BRANDING.primaryColor)
                        ]});

                        if (targetGuild) {
                            const bmtLog = new EmbedBuilder()
                                .setTitle("BMT Pass")
                                .setDescription(`${message.author} passed the BMT quiz (${session.score}/5) and was promoted to Private.`)
                                .setColor(EMBED_BRANDING.primaryColor)
                                .setTimestamp();
                            await sendLog(targetGuild, 'moderation', bmtLog);
                        }
                    } catch (err) {
                        await message.reply({ embeds: [
                            new EmbedBuilder()
                                .setTitle("Promotion Error")
                                .setDescription(`Passed (${session.score}/5), but the Roblox promotion failed:\n\`${err.message}\`\n\nShow this to an officer for a manual update.`)
                                .setColor(EMBED_BRANDING.errorColor)
                        ]});
                    }
                } else {
                    await message.reply({ embeds: [
                        new EmbedBuilder()
                            .setTitle("BMT Failed")
                            .setDescription(`Score: ${session.score}/${BMT_CONFIG.questions.length}. You need ${BMT_CONFIG.requiredCorrect} correct answers to pass.`)
                            .setColor(EMBED_BRANDING.errorColor)
                    ]});

                    const targetGuild = client.guilds.cache.get(session.guildId);
                    if (targetGuild) {
                        const bmtFailLog = new EmbedBuilder()
                            .setTitle("BMT Fail")
                            .setDescription(`${message.author} failed the BMT quiz (${session.score}/5).`)
                            .setColor(EMBED_BRANDING.errorColor)
                            .setTimestamp();
                        await sendLog(targetGuild, 'moderation', bmtFailLog);
                    }
                }
            }
        }
        return;
    }

    if (!db.licensedGuilds.includes(message.guild.id)) return;

    const serverConfig = db[message.guild.id];
    if (!serverConfig) return;
    
    const authorAdminLevel = getAdminLevel(message.guild, message.member);

    // --- !BGCHECK COMMAND ---
    if (message.content.toLowerCase().startsWith('!bgcheck')) {
        const args = message.content.split(' ');
        if (args.length < 2) {
            return message.reply({ embeds: [new EmbedBuilder().setDescription("Usage: `!bgcheck [username]`").setColor(EMBED_BRANDING.errorColor)] });
        }

        const targetUsername = args[1];
        const profileData = await getRobloxUser(targetUsername);

        if (!profileData) {
            return message.reply({ embeds: [new EmbedBuilder().setDescription("User not found.").setColor(EMBED_BRANDING.errorColor)] });
        }

        const pastNames = await getRobloxUserHistory(profileData.id);
        
        let groupStatus = "Not configured";
        if (serverConfig.groupId) {
            const groupInfo = await getRobloxFullGroupInfo(profileData.id, serverConfig.groupId);
            groupStatus = `${groupInfo.name} (Rank: ${groupInfo.rank})`;
        }

        const formattedDate = new Date(profileData.created).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        const bgCheckEmbed = new EmbedBuilder()
            .setAuthor({ name: EMBED_BRANDING.authorName, iconURL: EMBED_BRANDING.authorIcon })
            .setTitle(`Profile Check: ${profileData.username}`)
            .addFields(
                { name: "User ID", value: String(profileData.id), inline: true },
                { name: "Created", value: formattedDate, inline: true },
                { name: "Past Usernames", value: pastNames, inline: false },
                { name: "Group Status", value: groupStatus, inline: false }
            )
            .setColor(EMBED_BRANDING.primaryColor)
            .setTimestamp();

        return message.reply({ embeds: [bgCheckEmbed] });
    }

    if (message.content.toLowerCase().startsWith('!verify')) {
        if (!serverConfig.ticketCategory) {
            return message.reply({ embeds: [new EmbedBuilder().setDescription("Ticket category not set.").setColor(EMBED_BRANDING.errorColor)] });
        }
        const channels = await message.guild.channels.fetch().catch(() => null);
        if (channels) {
            const openCheck = channels.find(c => c && c.parentId === serverConfig.ticketCategory && c.type === ChannelType.GuildText && c.permissionOverwrites?.cache?.has(message.author.id));
            if (openCheck) {
                return message.reply({ embeds: [new EmbedBuilder().setDescription(`Verification ticket already open: ${openCheck}`).setColor(EMBED_BRANDING.errorColor)] });
            }
        }
        
        const simulatedInteraction = {
            user: message.author,
            member: message.member,
            guild: message.guild,
            channel: message.channel,
            replied: false,
            deferred: false,
            reply: async (payload) => message.reply(payload),
            editReply: async (payload) => message.reply(payload)
        };
        return await generateFinalTicket(simulatedInteraction, "verify", "verification", serverConfig.ticketCategory);
    }

    if (activeSessions.has(message.channel.id)) {
        const session = activeSessions.get(message.channel.id);
        if (session.userId !== message.author.id) return;

        const input = message.content.trim();

        if (input.toLowerCase() === 'cancel') {
            await message.reply({ embeds: [new EmbedBuilder().setDescription("Closing channel...").setColor(EMBED_BRANDING.errorColor)] });
            activeSessions.delete(message.channel.id);
            setTimeout(() => message.channel.delete().catch(() => {}), 3000);
            return;
        }

        if (session.step === 1) {
            const robloxUser = await getRobloxUser(input);
            if (!robloxUser) {
                return message.reply({ embeds: [new EmbedBuilder().setDescription("User not found. Retry or type `cancel`.").setColor(EMBED_BRANDING.errorColor)] });
            }
            session.robloxId = robloxUser.id;
            session.robloxUsername = robloxUser.username;
            session.step = 2;
            activeSessions.set(message.channel.id, session);

            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setTitle("Account Confirmation")
                    .setDescription(`Is this your profile? Reply YES or NO.`)
                    .addFields(
                        { name: "Username", value: robloxUser.username, inline: true },
                        { name: "ID", value: String(robloxUser.id), inline: true },
                        { name: "Profile", value: `[Link](https://www.roblox.com/users/${robloxUser.id}/profile)`, inline: false }
                    )
                    .setColor(EMBED_BRANDING.primaryColor)
            ]});
        }

        if (session.step === 2) {
            if (input.toLowerCase() === 'no') {
                session.step = 1;
                activeSessions.set(message.channel.id, session);
                return message.reply({ embeds: [new EmbedBuilder().setDescription("Type your correct username:").setColor(EMBED_BRANDING.primaryColor)] });
            }
            if (input.toLowerCase() !== 'yes') {
                return message.reply({ embeds: [new EmbedBuilder().setDescription("Reply with YES or NO.").setColor(EMBED_BRANDING.errorColor)] });
            }

            const code = generateVerificationCode();
            session.verificationCode = code;
            session.step = 3;
            activeSessions.set(message.channel.id, session);

            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setTitle("Ownership Verification")
                    .setDescription(`Paste this code into your Roblox profile description, save it, and type 'DONE' here.`)
                    .addFields({ name: "Code", value: `\`${code}\``, inline: false })
                    .setColor(EMBED_BRANDING.primaryColor)
            ]});
        }

        if (session.step === 3) {
            if (input.toLowerCase() !== 'done') {
                return message.reply({ embeds: [new EmbedBuilder().setDescription("Type `DONE` once saved.").setColor(EMBED_BRANDING.errorColor)] });
            }

            const liveUser = await getRobloxUserById(session.robloxId);
            if (!liveUser || !liveUser.description.toLowerCase().includes(session.verificationCode.toLowerCase())) {
                return message.reply({ 
                    embeds: [new EmbedBuilder()
                        .setTitle("Verification Failed")
                        .setDescription(`Code not detected in your description.\n\nExpected:\n\`${session.verificationCode}\``)
                        .setColor(EMBED_BRANDING.errorColor)]
                });
            }

            const simulatedInteraction = { channel: message.channel };
            activeSessions.delete(message.channel.id);
            await executeUserUpdate(simulatedInteraction, message.member, serverConfig, session.robloxId);
            
            const logEmbed = new EmbedBuilder()
                .setTitle("User Verified")
                .setDescription(`${message.author} linked to **${session.robloxUsername}** (${session.robloxId}).`)
                .setColor(EMBED_BRANDING.primaryColor)
                .setTimestamp();
            await sendLog(message.guild, 'verification', logEmbed);

            setTimeout(() => message.channel.delete().catch(() => {}), 7000);
            return;
        }
    }

    if (authorAdminLevel < 1) {
        const tagsOwner = message.mentions.users.has(message.guild.ownerId);
        const tagsProtected = message.mentions.users.some(u => PROTECTED_USERS.includes(u.id));
        if (tagsOwner || tagsProtected) {
            try {
                await message.delete().catch(() => {});
                await message.member.timeout(24 * 60 * 60 * 1000, "Mentioned protected user.").catch(() => {});
                
                const modEmbed = new EmbedBuilder()
                    .setTitle("Mute Executed")
                    .setDescription(`${message.author} muted for 24 hours (Protected ping).`)
                    .setColor(EMBED_BRANDING.errorColor)
                    .setTimestamp();
                await sendLog(message.guild, 'moderation', modEmbed);
                return;
            } catch (err) {}
        }
    }
});

client.on('interactionCreate', async interaction => {
    const guild = interaction.guild;
    const member = interaction.member;
    if (!guild) return;

    // --- INTERCEPT LICENSE COMMAND FIRST ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'add-license') {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Owner command only.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
        }
        const targetServerId = interaction.options.getString('server-id');
        if (!db.licensedGuilds.includes(targetServerId)) {
            db.licensedGuilds.push(targetServerId);
            saveDB();
        }
        return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Licensed server: \`${targetServerId}\``).setColor(EMBED_BRANDING.primaryColor)], ephemeral: true });
    }

    // --- BLOCK IF NOT LICENSED ---
    if (!db.licensedGuilds.includes(guild.id)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("Unlicensed Instance").setDescription("This guild is not authorized to interface with this application.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
    }

    if (!db[guild.id]) {
        db[guild.id] = { groupId: null, binds: [], adminUsers: {}, adminRoles: {}, ticketCategory: null, ticketCount: 0, robloxCookie: null, logChannels: {} };
        saveDB();
    }
    const serverConfig = db[guild.id];
    const callerAdminLevel = getAdminLevel(guild, member);

    if (interaction.isChatInputCommand()) {
        
        if (interaction.commandName === 'set-cookie') {
            if (callerAdminLevel < 8) {
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Server owner command only.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
            }
            serverConfig.robloxCookie = interaction.options.getString('cookie');
            saveDB();
            return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Cookie updated.").setColor(EMBED_BRANDING.primaryColor)], ephemeral: true });
        }

        if (interaction.commandName === 'configure-group') {
            if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access denied.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
            serverConfig.groupId = interaction.options.getInteger('group-id');
            saveDB();
            return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Group ID updated: **${serverConfig.groupId}**`).setColor(EMBED_BRANDING.primaryColor)] });
        }

        if (interaction.commandName === 'set-log-channel') {
            if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access denied.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
            const logType = interaction.options.getString('type');
            const targetChan = interaction.options.getChannel('channel');
            if (!serverConfig.logChannels) serverConfig.logChannels = {};
            serverConfig.logChannels[logType] = targetChan.id;
            saveDB();
            return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Logs for **${logType}** redirected to ${targetChan}`).setColor(EMBED_BRANDING.primaryColor)] });
        }

        if (interaction.commandName === 'bind') {
            if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access denied.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
            
            const subcommand = interaction.options.getSubcommand();
            if (!serverConfig.binds || !Array.isArray(serverConfig.binds)) serverConfig.binds = [];

            if (subcommand === 'add' || subcommand === 'range') {
                const rolesInput = interaction.options.getString('roles');
                const prefix = interaction.options.getString('prefix') || null;

                const extractedIds = [...rolesInput.matchAll(/\d+/g)].map(match => match[0]);
                const validRoleIds = extractedIds.filter(id => interaction.guild.roles.cache.has(id));

                if (validRoleIds.length === 0) {
                    return interaction.reply({ embeds: [new EmbedBuilder().setDescription("No valid roles provided.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
                }

                if (subcommand === 'add') {
                    const compare = interaction.options.getString('comparison') || '==';
                    const rank = interaction.options.getInteger('rank-value');

                    serverConfig.binds.push({ roleIds: validRoleIds, compare: compare, rank: rank, prefix: prefix });
                    saveDB();

                    const rolesString = validRoleIds.map(id => `<@&${id}>`).join(', ');
                    return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Bound rank **${compare} ${rank}** to: ${rolesString}`).setColor(EMBED_BRANDING.primaryColor)] });
                }

                if (subcommand === 'range') {
                    const minRank = interaction.options.getInteger('min-rank');
                    const maxRank = interaction.options.getInteger('max-rank');

                    serverConfig.binds.push({ roleIds: validRoleIds, compare: 'range', minRank: minRank, maxRank: maxRank, prefix: prefix });
                    saveDB();

                    const rolesString = validRoleIds.map(id => `<@&${id}>`).join(', ');
                    return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Bound range **${minRank}-${maxRank}** to: ${rolesString}`).setColor(EMBED_BRANDING.primaryColor)] });
                }
            }

            if (subcommand === 'clear') {
                serverConfig.binds = [];
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Cleared all active binds.").setColor(EMBED_BRANDING.primaryColor)] });
            }

            if (subcommand === 'list') {
                if (!serverConfig.binds || serverConfig.binds.length === 0) {
                    return interaction.reply({ embeds: [new EmbedBuilder().setDescription("No active binds.").setColor(EMBED_BRANDING.errorColor)] });
                }

                const listEmbed = new EmbedBuilder()
                    .setAuthor({ name: EMBED_BRANDING.authorName, iconURL: EMBED_BRANDING.authorIcon })
                    .setTitle("Active Bind configurations")
                    .setColor(EMBED_BRANDING.primaryColor);

                let descriptions = serverConfig.binds.map((b, i) => {
                    const rolesStr = b.roleIds ? b.roleIds.map(id => `<@&${id}>`).join(', ') : `<@&${b.roleId}>`;
                    if (b.compare === 'range') return `**${i + 1}.** Rank \`[${b.minRank}-${b.maxRank}]\` ➔ ${rolesStr}`;
                    return `**${i + 1}.** Rank \`${b.compare} ${b.rank}\` ➔ ${rolesStr}`;
                });

                listEmbed.setDescription(descriptions.join('\n'));
                return interaction.reply({ embeds: [listEmbed] });
            }
        }

        if (interaction.commandName === 'promote' || interaction.commandName === 'demote' || interaction.commandName === 'setrank') {
            if (callerAdminLevel < 2) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access denied.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
            await interaction.deferReply();
            
            const targetUserString = interaction.options.getString('username');
            const targetProfile = await getRobloxUser(targetUserString);
            if (!targetProfile) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("User not found.").setColor(EMBED_BRANDING.errorColor)] });

            const currentRank = await getRobloxUserRank(targetProfile.id, serverConfig.groupId);
            let finalRankTarget = currentRank;

            if (interaction.commandName === 'promote') finalRankTarget = currentRank + 1;
            else if (interaction.commandName === 'demote') finalRankTarget = currentRank - 1;
            else finalRankTarget = interaction.options.getInteger('rank-value');

            if (finalRankTarget < 1 || finalRankTarget > 255) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("Value range is 1-255.").setColor(EMBED_BRANDING.errorColor)] });
            }

            try {
                const assignedRoleName = await changeRobloxRank(guild.id, targetProfile.id, finalRankTarget);
                
                const rankLog = new EmbedBuilder()
                    .setTitle(`Admin Rank Modification`)
                    .setDescription(`Target: **${targetProfile.username}** updated by ${interaction.user}.`)
                    .addFields(
                        { name: "Old", value: String(currentRank), inline: true },
                        { name: "New", value: `${finalRankTarget} (${assignedRoleName})`, inline: true }
                    )
                    .setColor(EMBED_BRANDING.primaryColor);
                await sendLog(guild, 'moderation', rankLog);

                const matchedDiscordUser = Object.keys(db.globalVerifiedUsers || {}).find(key => db.globalVerifiedUsers[key] === targetProfile.id);
                if (matchedDiscordUser) {
                    const foundMember = await guild.members.fetch(matchedDiscordUser).catch(() => null);
                    if (foundMember) await executeUserUpdate(interaction, foundMember, serverConfig, targetProfile.id);
                }

                return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Updated **${targetProfile.username}** to rank: **${assignedRoleName}**`).setColor(EMBED_BRANDING.primaryColor)] });
            } catch (err) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Error: ${err.message}`).setColor(EMBED_BRANDING.errorColor)] });
            }
        }

        if (interaction.commandName === 'send-panel') {
            if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access denied.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
            
            const verifyEmbed = new EmbedBuilder()
                .setAuthor({ name: EMBED_BRANDING.authorName, iconURL: EMBED_BRANDING.authorIcon })
                .setTitle(`${EMBED_BRANDING.groupName} Verification Portal`)
                .setDescription("Select a method below to synchronize or link your profile.")
                .setColor(EMBED_BRANDING.primaryColor);

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_trigger_verify_login').setLabel('Verify Account').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('panel_trigger_verify_ticket').setLabel('Support Ticket').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('btn_update_roles').setLabel('Sync Roles').setStyle(ButtonStyle.Success)
            );
            
            await interaction.reply({ embeds: [new EmbedBuilder().setDescription("Portal interface posted.").setColor(EMBED_BRANDING.primaryColor)], ephemeral: true });
            return interaction.channel.send({ embeds: [verifyEmbed], components: [actionRow] });
        }

        if (interaction.commandName === 'ticket') {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'panel') {
                if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access denied.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
                
                const reportEmbed = new EmbedBuilder()
                    .setAuthor({ name: EMBED_BRANDING.authorName, iconURL: EMBED_BRANDING.authorIcon })
                    .setTitle("Incident Reports")
                    .setDescription("Select report category from the options menu.")
                    .setColor(EMBED_BRANDING.primaryColor);

                const menuReport = new StringSelectMenuBuilder()
                    .setCustomId('menu_ticket_report')
                    .setPlaceholder('Select Category')
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel('Report High Rank').setValue('report_high_rank'),
                        new StringSelectMenuOptionBuilder().setLabel('Report Exploiter').setValue('report_exploiter'),
                        new StringSelectMenuOptionBuilder().setLabel('Report Abuse').setValue('report_abuser')
                    );
                
                await interaction.reply({ embeds: [new EmbedBuilder().setDescription("Interface deployed.").setColor(EMBED_BRANDING.primaryColor)], ephemeral: true });
                return await interaction.channel.send({ embeds: [reportEmbed], components: [new ActionRowBuilder().addComponents(menuReport)] });
            }

            if (subcommand === 'configure') {
                if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access denied.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
                serverConfig.ticketCategory = interaction.options.getChannel('category').id;
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Category channel updated.").setColor(EMBED_BRANDING.primaryColor)] });
            }
        }

        if (interaction.commandName === 'bmt') {
            if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access denied.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
            
            const bmtPanelEmbed = new EmbedBuilder()
                .setAuthor({ name: EMBED_BRANDING.authorName, iconURL: EMBED_BRANDING.authorIcon })
                .setTitle(`${EMBED_BRANDING.groupName} | Basic Training Entry`)
                .setDescription("Click below to start your direct DM training quiz assessment. (Requires 4/5 score to pass).")
                .setColor(EMBED_BRANDING.primaryColor);

            const bmtActionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_start_bmt').setLabel('Start Evaluation').setStyle(ButtonStyle.Primary)
            );

            await interaction.reply({ embeds: [new EmbedBuilder().setDescription("BMT terminal posted.").setColor(EMBED_BRANDING.primaryColor)], ephemeral: true });
            return interaction.channel.send({ embeds: [bmtPanelEmbed], components: [bmtActionRow] });
        }

        if (interaction.commandName === 'update') {
            await interaction.deferReply({ ephemeral: true });
            return executeUserUpdate(interaction, member, serverConfig);
        }
    }

    else if (interaction.isButton()) {
        if (interaction.customId === 'btn_close_ticket') {
            await interaction.reply({ embeds: [new EmbedBuilder().setDescription("Deconstruction in process... Room closing.").setColor(EMBED_BRANDING.errorColor)] });
            if (activeSessions.has(interaction.channel.id)) activeSessions.delete(interaction.channel.id);
            
            const closeLog = new EmbedBuilder()
                .setDescription(`Ticket channel ${interaction.channel.name} closed by ${interaction.user}.`)
                .setColor(EMBED_BRANDING.errorColor);
            await sendLog(guild, 'tickets', closeLog);
            
            setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
            return;
        }

        if (interaction.customId === 'btn_start_bmt') {
            if (!db.globalVerifiedUsers || !db.globalVerifiedUsers[interaction.user.id]) {
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Verify your Roblox profile link first.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
            }

            try {
                bmtSessions.set(interaction.user.id, { step: 0, score: 0, guildId: guild.id });
                await interaction.user.send({ embeds: [
                    new EmbedBuilder()
                        .setTitle("BMT Examination")
                        .setDescription(`**Question 1:** ${BMT_CONFIG.questions[0].q}`)
                        .setColor(EMBED_BRANDING.primaryColor)
                ]});
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Quiz check sent to DMs.").setColor(EMBED_BRANDING.primaryColor)], ephemeral: true });
            } catch (err) {
                bmtSessions.delete(interaction.user.id);
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Unable to send DM. Check privacy metrics.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
            }
        }

        const cooldownKey = `${interaction.user.id}_ticket_cooldown`;
        if (interaction.customId.startsWith('panel_trigger_verify')) {
            if (cooldowns.has(cooldownKey) && cooldowns.get(cooldownKey) > Date.now()) {
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Rate limit active. Wait before re-trying.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
            }
        }

        if (interaction.customId === 'panel_trigger_verify_ticket' || interaction.customId === 'panel_trigger_verify_login') {
            await interaction.deferReply({ ephemeral: true });
            if (!serverConfig.ticketCategory) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("Configuration missing.").setColor(EMBED_BRANDING.errorColor)] });

            const channels = await interaction.guild.channels.fetch().catch(() => null);
            if (channels) {
                const openCheck = channels.find(c => c && c.parentId === serverConfig.ticketCategory && c.type === ChannelType.GuildText && c.permissionOverwrites?.cache?.has(interaction.user.id));
                if (openCheck) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Active target available: ${openCheck}`).setColor(EMBED_BRANDING.errorColor)] });
            }

            cooldowns.set(cooldownKey, Date.now() + 10000); 
            return await generateFinalTicket(interaction, "verify", "verification", serverConfig.ticketCategory);
        }

        if (interaction.customId === 'btn_update_roles') {
            await interaction.deferReply({ ephemeral: true });
            return await executeUserUpdate(interaction, member, serverConfig);
        }
    }

    else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'menu_ticket_report' || interaction.customId === 'menu_ticket_other') {
            const cooldownKey = `${interaction.user.id}_ticket_cooldown`;
            if (cooldowns.has(cooldownKey) && cooldowns.get(cooldownKey) > Date.now()) {
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Action locked on cooldown.").setColor(EMBED_BRANDING.errorColor)], ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            const selection = interaction.values[0];
            let cleanChannelPrefix = selection.startsWith('report_') ? "report" : "other";
            let selectionLabel = selection.replace('report_', '').replace('other_', '').replace(/_/g, '-');

            if (!serverConfig.ticketCategory) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("Target metrics missing.").setColor(EMBED_BRANDING.errorColor)] });

            const channels = await interaction.guild.channels.fetch().catch(() => null);
            if (channels) {
                const openCheck = channels.find(c => c && c.parentId === serverConfig.ticketCategory && c.type === ChannelType.GuildText && c.permissionOverwrites?.cache?.has(interaction.user.id));
                if (openCheck) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Active ticket space: ${openCheck}`).setColor(EMBED_BRANDING.errorColor)] });
            }

            cooldowns.set(cooldownKey, Date.now() + 10000);
            return await generateFinalTicket(interaction, cleanChannelPrefix, selectionLabel, serverConfig.ticketCategory);
        }
    }
});

client.login(TOKEN);