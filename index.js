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
    PermissionsBitField
} = require('discord.js');
const { request } = require('undici');
const fs = require('fs');
const path = require('path');

const commands = require(path.join(__dirname, 'commands.js')); 

// ----------------- CONFIGURATION LOADING -----------------
const CONFIG_FILE = './config.json';
let config = {};

if (fs.existsSync(CONFIG_FILE)) {
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) {
        console.error("Local configuration file could not be parsed.");
    }
}

const TOKEN = process.env.TOKEN || config.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || config.CLIENT_ID;
const VERIFIED_ROLE_NAME = process.env.VERIFIED_ROLE_NAME || config.VERIFIED_ROLE_NAME || "Verified";
const PROTECTED_USERS = config.QUARANTINE_PROTECTED_IDS || [];

if (!TOKEN) {
    console.error("Critical Error: The application token is missing from your environment or configuration.");
    process.exit(1);
}

const DB_FILE = './database.json';
const cooldowns = new Map();

// ----------------- DATABASE UTILITIES -----------------
let db = {};
if (!fs.existsSync(DB_FILE)) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 2), 'utf8');
    } catch (err) { console.error("Could not create database file:", err); }
} else {
    try {
        const content = fs.readFileSync(DB_FILE, 'utf8').trim();
        db = content ? JSON.parse(content) : {};
    } catch { db = {}; }
}

function saveDB() {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) {}
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
                highestLevel = Math.max(highestLevel, level);
            }
        }
    }
    if (highestLevel === 0 && member.permissions.has(PermissionFlagsBits.Administrator)) {
        return 1; 
    }
    return highestLevel;
}

function parseDuration(str) {
    if (!str) return null;
    const match = str.match(/^(\d+)([mhwd])$/i);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    switch (unit) {
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'w': return value * 7 * 24 * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

// ----------------- CLIENT INITIALIZATION -----------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
    ]
});

client.once('ready', async () => {
    console.log(`Bot connected and running as ${client.user.tag}`);
    try {
        const restInstance = new REST({ version: '10' }).setToken(TOKEN);
        await restInstance.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    } catch (e) { console.error("Failed to register global application commands:", e); }
});

// ----------------- SECURITY: ANTI-PING SENTRY -----------------
client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    
    const serverConfig = db[message.guild.id];
    const authorAdminLevel = getAdminLevel(message.guild, message.member);

    if (authorAdminLevel < 1) { 
        const containsProtectedPing = message.mentions.users.some(user => PROTECTED_USERS.includes(user.id));
        
        if (containsProtectedPing) {
            try {
                await message.delete().catch(() => {}); 
                await message.member.timeout(24 * 60 * 60 * 1000, "Wick Security: Pinged a strict-containment protected user account.").catch(() => {});
                
                await message.author.send({
                    embeds: [new EmbedBuilder()
                        .setTitle("⚠️ Security Containment Notice")
                        .setDescription(`You have been instantly muted in **${message.guild.name}** for pinging a heavily protected administration/management profile.`)
                        .setColor(0xC0392B)]
                }).catch(() => {});

                if (serverConfig && serverConfig.logChannelId) {
                    const logs = await message.guild.channels.fetch(serverConfig.logChannelId).catch(() => null);
                    if (logs) {
                        const alert = new EmbedBuilder()
                            .setTitle("🔒 CRITICAL USER PING VIOLATION")
                            .setDescription(`**Account Instantly Silenced**\n\n• **User:** ${message.author} (\`${message.author.tag}\`)\n• **Violation:** Mentions sent directly to a restricted high-clearance target profile.\n• **Action:** Message purged, **24 Hour Instant Timeout** applied.`)
                            .setColor(0xD35400)
                            .setTimestamp();
                        await logs.send({ embeds: [alert] });
                    }
                }
                return; 
            } catch (e) { console.error("Error executing user ping gate timeout:", e); }
        }
    }

    if (serverConfig && serverConfig.security && serverConfig.security.antiPingEnabled) {
        const maxMentionsAllowed = serverConfig.security.antiPingMaxPings || 5;
        const totalMentions = message.mentions.users.size + message.mentions.roles.size;
        
        if (totalMentions > maxMentionsAllowed) {
            if (authorAdminLevel >= 1) return; 

            try {
                await message.delete().catch(() => {});
                await message.member.timeout(30 * 60 * 1000, "Anti-Ping protection: Exceeded maximum text mentions flag limit.").catch(() => {});
                
                if (serverConfig.logChannelId) {
                    const logs = await message.guild.channels.fetch(serverConfig.logChannelId).catch(() => null);
                    if (logs) {
                        const alert = new EmbedBuilder()
                            .setTitle("Anti-Ping Protection Triggered")
                            .setDescription(`User ${message.author.tag} was automatically muted for 30 minutes after sending a message containing ${totalMentions} pings.`)
                            .setColor(0xE67E22)
                            .setTimestamp();
                        await logs.send({ embeds: [alert] });
                    }
                }
            } catch (e) { console.error("Anti-ping processing error:", e); }
        }
    }
});

// ----------------- ROBLOX COMMUNICATIONS -----------------
async function getRobloxUser(username) {
    try {
        const lookupResponse = await request('https://users.roblox.com/v1/usernames/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
        });
        const lookupData = await lookupResponse.body.json();
        if (lookupData.data && lookupData.data.length > 0) {
            const user = lookupData.data[0];
            const userId = user.id;
            const profileResult = await request(`https://users.roblox.com/v1/users/${userId}`);
            const profileData = await profileResult.body.json();
            return { id: userId, username: user.requestedUsername || user.name, description: profileData.description || "" };
        }
    } catch (e) { console.error("Roblox user resolution failed:", e); }
    return null;
}

async function getRobloxUserById(userId) {
    try {
        const profileResult = await request(`https://users.roblox.com/v1/users/${userId}`);
        const profileData = await profileResult.body.json();
        if (profileData && profileData.id) {
            return { id: profileData.id, username: profileData.name, description: profileData.description || "" };
        }
    } catch (e) { console.error("Roblox ID lookup failed:", e); }
    return null;
}

async function getRobloxUserRank(userId, groupId) {
    try {
        const res = await request(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
        const data = await res.body.json();
        if (data.data) {
            const group = data.data.find(g => g.group.id === groupId);
            return group ? group.role.rank : 0; 
        }
    } catch (e) { console.error("Roblox rank retrieval failed:", e); }
    return 0;
}

async function fetchRobloxTokenSignature(cookie) {
    try {
        const res = await request('https://auth.roblox.com/v2/logout', {
            method: 'POST',
            headers: { 'Cookie': `.ROBLOX_SECURITY=${cookie}` }
        });
        return res.headers['x-csrf-token'] || null;
    } catch { return null; }
}

async function fetchRobloxRoleSets(groupId) {
    try {
        const res = await request(`https://groups.roblox.com/v1/groups/${groupId}/roles`);
        const data = await res.body.json();
        return data.roles || [];
    } catch { return []; }
}

// ----------------- BOT COMMAND PROCESSOR -----------------
client.on('interactionCreate', async interaction => {
    const guild = interaction.guild;
    const member = interaction.member;
    if (!guild) return;

    if (!db.globalVerifiedUsers) db.globalVerifiedUsers = {};
    if (!db[guild.id]) {
        db[guild.id] = { groupId: null, binds: {}, adminUsers: {}, adminRoles: {}, ticketCategory: null, ticketCount: 0, robloxCookie: null, security: { antiPingEnabled: false } };
    }
    
    const serverConfig = db[guild.id];
    const callerAdminLevel = getAdminLevel(guild, member);

    if (interaction.isChatInputCommand()) {
        
        // SECURITY TOGGLE ROUTINE
        if (interaction.commandName === 'security') {
            const subcommand = interaction.options.getSubcommand();
            if (!serverConfig.security) serverConfig.security = { antiPingEnabled: false };

            if (subcommand === 'anti-ping') {
                if (callerAdminLevel < 7) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access Denied. Level 7 administrative clearance is required.").setColor(0xE67E22)], ephemeral: true });
                const state = interaction.options.getBoolean('enabled');
                const maxPings = interaction.options.getInteger('max-pings') || 5;
                serverConfig.security.antiPingEnabled = state;
                serverConfig.security.antiPingMaxPings = maxPings;
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Anti-ping settings updated. Enabled: ${state} | Max mentions per message: ${maxPings}`).setColor(0x2ECC71)] });
            }
        }

        // VIEW/EDIT ADMINISTRATIVE HIERARCHY LEVELS
        if (interaction.commandName === 'admin') {
            const subcommand = interaction.options.getSubcommand();
            
            if (subcommand === 'view') {
                let userLines = [];
                let roleLines = [];

                if (serverConfig.adminUsers) {
                    for (const [userId, val] of Object.entries(serverConfig.adminUsers)) {
                        userLines.push(`<@${userId}> (ID: \`${userId}\`) - Level ${val}`);
                    }
                }
                if (serverConfig.adminRoles) {
                    for (const [roleId, val] of Object.entries(serverConfig.adminRoles)) {
                        roleLines.push(`<@&${roleId}> (ID: \`${roleId}\`) - Level ${val}`);
                    }
                }

                const embed = new EmbedBuilder()
                    .setTitle("Administrative Authorization Levels")
                    .setDescription("Configured bot access accounts and groups")
                    .addFields(
                        { name: "Administrators", value: userLines.length ? userLines.join("\n") : "No specific users configured.", inline: false },
                        { name: "Authorized Roles", value: roleLines.length ? roleLines.join("\n") : "No roles assigned clearance levels.", inline: false }
                    )
                    .setColor(0x2B2D31);
                return interaction.reply({ embeds: [embed] });
            }

            if (callerAdminLevel === 0) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("You do not have permission to adjust administrative hierarchies.").setColor(0xE67E22)], ephemeral: true });
            if (subcommand === 'add') {
                const lvl = interaction.options.getInteger('level');
                const targetU = interaction.options.getUser('user');
                const targetR = interaction.options.getRole('role');
                if (lvl >= callerAdminLevel) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("You cannot grant an administrative rank equal to or higher than your own.").setColor(0xE67E22)], ephemeral: true });
                if (targetU) serverConfig.adminUsers[targetU.id] = lvl;
                if (targetR) serverConfig.adminRoles[targetR.id] = lvl;
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Administrative rules updated successfully.").setColor(0x3498DB)] });
            }
            if (subcommand === 'delete') {
                const targetU = interaction.options.getUser('user');
                const targetR = interaction.options.getRole('role');
                if (targetU) delete serverConfig.adminUsers[targetU.id];
                if (targetR) delete serverConfig.adminRoles[targetR.id];
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Administrative permissions revoked.").setColor(0x3498DB)] });
            }
        }

        // RANKBINDS SYSTEM MODULE
        if (interaction.commandName === 'rankbinds') {
            const subcommand = interaction.options.getSubcommand();
            
            if (subcommand === 'view') {
                let bindLines = [];
                if (serverConfig.binds && Object.keys(serverConfig.binds).length > 0) {
                    for (const [rankId, data] of Object.entries(serverConfig.binds)) {
                        bindLines.push(`**Rank ID ${rankId}**: <@&${data.roleId}> | Prefix: \`${data.prefix || "None"}\``);
                    }
                }
                
                const embed = new EmbedBuilder()
                    .setTitle("Roblox Rank Bindings")
                    .setDescription(`Group Profile ID: \`${serverConfig.groupId || "Not Set"}\``)
                    .addFields({ name: "Configured Rules", value: bindLines.length ? bindLines.join("\n") : "No rank mapping layout has been defined yet." })
                    .setColor(0x2B2D31);
                return interaction.reply({ embeds: [embed] });
            }

            if (callerAdminLevel === 0) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("You must be an administrator to manage rank bindings.").setColor(0xE67E22)], ephemeral: true });
            if (subcommand === 'add') {
                const gId = interaction.options.getInteger('groupid');
                const rId = interaction.options.getInteger('rankid');
                const prefix = interaction.options.getString('prefix');
                const role = interaction.options.getRole('role');
                serverConfig.groupId = gId; 
                if (!serverConfig.binds) serverConfig.binds = {};
                serverConfig.binds[rId] = { prefix, roleId: role.id };
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Successfully bound Roblox Rank ID ${rId} to role ${role.name}.`).setColor(0x3498DB)] });
            }
            if (subcommand === 'delete') {
                const rId = interaction.options.getInteger('rankid');
                if (serverConfig.binds) delete serverConfig.binds[rId];
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Removed the binding rule for Roblox Rank ID ${rId}.`).setColor(0x3498DB)] });
            }
        }

        // TICKET SYSTEM ENGINE
        if (interaction.commandName === 'ticket') {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'configure') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && callerAdminLevel === 0) {
                    return interaction.reply({ embeds: [new EmbedBuilder().setDescription("You do not have permission to manage the ticket category setup.").setColor(0xE67E22)], ephemeral: true });
                }
                const category = interaction.options.getChannel('category');
                serverConfig.ticketCategory = category.id;
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Ticket category successfully changed to ${category.name}`).setColor(0x3498DB)], ephemeral: true });
            }
            if (subcommand === 'add') {
                if (!interaction.channel.name.startsWith('ticket-')) {
                    return interaction.reply({ embeds: [new EmbedBuilder().setDescription("This command can only be used inside a ticket channel.").setColor(0xE67E22)], ephemeral: true });
                }
                const target = interaction.options.getUser('target');
                await interaction.channel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Added ${target.username} to the ticket channel.`).setColor(0x3498DB)] });
            }
            if (subcommand === 'panel') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && callerAdminLevel === 0) {
                    return interaction.reply({ embeds: [new EmbedBuilder().setDescription("You do not have permission to send a ticket panel.").setColor(0xE67E22)], ephemeral: true });
                }
                const type = interaction.options.getString('type');
                const embed = new EmbedBuilder().setTitle(`${type.toUpperCase()} TICKETS`).setDescription('Click the button below to open a support ticket.').setColor(0x3498DB);
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_btn_${type}`).setLabel('Create Ticket').setStyle(ButtonStyle.Danger));
                await interaction.channel.send({ embeds: [embed], components: [row] });
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("The interactive ticket panel has been posted.").setColor(0x3498DB)], ephemeral: true });
            }
        }

        if (interaction.commandName === 'verification-logs') {
            if (callerAdminLevel === 0) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("You must be a bot administrator to configure logs.").setColor(0xE67E22)], ephemeral: true });
            const logChannel = interaction.options.getChannel('channel');
            serverConfig.logChannelId = logChannel.id;
            saveDB();
            return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`System logs are now routed to ${logChannel}.`).setColor(0x3498DB)] });
        }

        // CORE CHAT MODERATION MODULES
        if (['warn', 'mute', 'unmute', 'ban'].includes(interaction.commandName)) {
            if (callerAdminLevel === 0) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("You do not have administrative clearance to run this command.").setColor(0xE67E22)], ephemeral: true });
            const targetUser = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || "No reason specified.";
            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

            if (!targetMember) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("The specified user could not be found in this server.").setColor(0xE67E22)], ephemeral: true });
            if (getAdminLevel(guild, targetMember) >= callerAdminLevel) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Permission denied. You cannot moderate a user with equal or higher admin standing.").setColor(0xE67E22)], ephemeral: true });

            if (interaction.commandName === 'warn') {
                await targetUser.send({ embeds: [new EmbedBuilder().setTitle("Warning Notification").setDescription(`You have received a formal warning in ${guild.name}\nReason: ${reason}`).setColor(0xE67E22)] }).catch(() => {});
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Successfully logged a warning for ${targetUser.tag}.`).setColor(0x3498DB)] });
            }
            if (interaction.commandName === 'mute') {
                const durationMs = parseDuration(interaction.options.getString('duration'));
                if (!durationMs) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Invalid duration format. Use formatting such as 30m, 2h, or 1d.").setColor(0xE67E22)], ephemeral: true });
                await targetMember.timeout(durationMs, reason).catch(() => {});
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Successfully timed out ${targetUser.tag}.`).setColor(0x3498DB)] });
            }
            if (interaction.commandName === 'unmute') {
                await targetMember.timeout(null, reason).catch(() => {});
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Successfully removed timeout from ${targetUser.tag}.`).setColor(0x3498DB)] });
            }
            if (interaction.commandName === 'ban') {
                await targetMember.ban({ reason }).catch(() => {});
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Successfully banned ${targetUser.tag} from the server.`).setColor(0x3498DB)] });
            }
        }

        if (interaction.commandName === 'unban') {
            if (callerAdminLevel === 0) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("You must be a bot administrator to lift bans.").setColor(0xE67E22)], ephemeral: true });
            const targetUserId = interaction.options.getString('userid');
            await guild.members.unban(targetUserId).catch(() => {});
            return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Ban lifted for user account ID ${targetUserId}.`).setColor(0x3498DB)] });
        }

        // BLOXLINK-STYLE USER PROFILE SYNCHRONIZATION COMMAND
        if (interaction.commandName === 'update') {
            if (!serverConfig.groupId) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("The Roblox group profile binding has not been configured yet.").setColor(0xE67E22)], ephemeral: true });
            await interaction.deferReply();
            
            let robloxUser = null;
            if (db.globalVerifiedUsers[member.id]) robloxUser = await getRobloxUserById(db.globalVerifiedUsers[member.id]);
            if (!robloxUser) robloxUser = await getRobloxUser((member.nickname || member.user.username).replace(/^\[[^\]]+\]\s*/, '').trim());
            
            if (!robloxUser) {
                return interaction.editReply({ 
                    embeds: [
                        new EmbedBuilder()
                            .setDescription("Could not find your linked Roblox profile. Please make sure your Discord nickname or username matches your Roblox account, then try again.")
                            .setColor('#E67E22')
                    ] 
                });
            }

            db.globalVerifiedUsers[member.id] = robloxUser.id;
            saveDB();

            const rankValue = await getRobloxUserRank(robloxUser.id, serverConfig.groupId);
            
            if (rankValue === 0) {
                return interaction.editReply({ 
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("Verification Denied")
                            .setDescription(`You are not a member of our connected Roblox Group (ID: \`${serverConfig.groupId}\`). Please join the group before trying to sync your roles.`)
                            .setColor(0xC0392B)
                    ] 
                });
            }

            const bindConfig = serverConfig.binds ? serverConfig.binds[rankValue] : null;
            let assignedPrefix = "None";
            let targetRoleId = null;

            if (bindConfig) {
                assignedPrefix = bindConfig.prefix ? `[${bindConfig.prefix.replace(/[\[\]]/g, '')}]` : "None";
                targetRoleId = bindConfig.roleId || null;
            }

            const formatPrefix = assignedPrefix !== "None" ? `${assignedPrefix} ` : "";
            const targetNickname = `${formatPrefix}${robloxUser.username}`.substring(0, 32);
            await member.setNickname(targetNickname).catch(() => {});
            
            const verifiedRole = guild.roles.cache.find(r => r.name === VERIFIED_ROLE_NAME);
            if (verifiedRole) await member.roles.add(verifiedRole).catch(() => {});

            let rolesAddedText = "None";
            let rolesRemovedText = "None";

            if (targetRoleId) {
                if (!member.roles.cache.has(targetRoleId)) {
                    await member.roles.add(targetRoleId).catch(() => {});
                    rolesAddedText = `<@&${targetRoleId}>`;
                }
                
                for (const [rId, bind] of Object.entries(serverConfig.binds || {})) {
                    if (Number(rId) !== rankValue && bind.roleId && member.roles.cache.has(bind.roleId)) {
                        await member.roles.remove(bind.roleId).catch(() => {});
                        rolesRemovedText = `<@&${bind.roleId}>`;
                    }
                }
            }

            // Clean Bloxlink Grid Aesthetic Layout
            const responseEmbed = new EmbedBuilder()
                .setTitle("Profile Settings Synchronized")
                .setDescription(`Successfully verified data tables for **${robloxUser.username}**.`)
                .addFields(
                    { name: "Prefix Applied", value: `\`${assignedPrefix}\``, inline: true },
                    { name: "Group Rank ID", value: `\`${rankValue}\``, inline: true },
                    { name: "Granted Roles", value: rolesAddedText, inline: false },
                    { name: "Removed Roles", value: rolesRemovedText, inline: false }
                )
                .setColor('#2F619E');

            return interaction.editReply({ embeds: [responseEmbed] });
        }

        // ROBLOX SESSION AUTHENTICATION
        if (interaction.commandName === 'roblox-cookie') {
            if (callerAdminLevel < 5) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access denied. Level 5 clearance required.").setColor(0xE67E22)], ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const inputCookie = interaction.options.getString('cookie');
            const targetGroup = interaction.options.getString('groupid');

            const userLookup = await request('https://users.roblox.com/v1/users/authenticated', { headers: { 'Cookie': `.ROBLOX_SECURITY=${inputCookie}` } });
            if (userLookup.statusCode !== 200) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("The provided cookie token was rejected by the Roblox API.").setColor(0xE67E22)] });
            
            const userData = await userLookup.body.json();
            serverConfig.robloxCookie = inputCookie;
            serverConfig.groupId = Number(targetGroup);
            saveDB();
            return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Session successfully authenticated under Roblox user account: ${userData.name}`).setColor(0x3498DB)] });
        }

        // DIRECT ROBLOX GROUP MANAGEMENT UTILITIES (/promote, /demote, /set-rank)
        if (['promote', 'demote', 'set-rank'].includes(interaction.commandName)) {
            if (callerAdminLevel < 5) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access denied. Level 5 clearance required.").setColor(0xE67E22)], ephemeral: true });
            if (!serverConfig.robloxCookie || !serverConfig.groupId) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("The Roblox group management session has not been set up with a group cookie.").setColor(0xE67E22)], ephemeral: true });

            await interaction.deferReply();
            const username = interaction.options.getString('username');
            const profile = await getRobloxUser(username);
            if (!profile) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("Could not find a Roblox account matching that username.").setColor(0xE67E22)] });

            const token = await fetchRobloxTokenSignature(serverConfig.robloxCookie);
            let endpoint = `https://groups.roblox.com/v1/groups/${serverConfig.groupId}/users/${profile.id}/${interaction.commandName}`;
            let reqMethod = 'POST';
            let reqBody = null;

            if (interaction.commandName === 'set-rank') {
                const targetRankId = interaction.options.getInteger('rankid');
                const rolesList = await fetchRobloxRoleSets(serverConfig.groupId);
                const match = rolesList.find(r => r.rank === targetRankId);
                if (!match) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("The targeted rank number does not exist within the configuration of your Roblox group.").setColor(0xE67E22)] });
                endpoint = `https://groups.roblox.com/v1/groups/${serverConfig.groupId}/users/${profile.id}`;
                reqMethod = 'PATCH';
                reqBody = JSON.stringify({ roleId: match.id });
            }

            const res = await request(endpoint, {
                method: reqMethod,
                headers: { 'Cookie': `.ROBLOX_SECURITY=${serverConfig.robloxCookie}`, 'X-CSRF-TOKEN': token || '', 'Content-Type': 'application/json' },
                body: reqBody
            });

            if (res.statusCode !== 200) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("The Roblox API rejected the rank adjustment update.").setColor(0xE67E22)] });
            return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Successfully modified the Roblox group ranking configuration for user: ${profile.username}`).setColor(0x3498DB)] });
        }
    }

    // INTERACTIVE PANEL SUPPORT BUTTON HANDLING
    if (interaction.isButton() && interaction.customId.startsWith('ticket_btn_')) {
        const type = interaction.customId.replace('ticket_btn_', '');
        if (!serverConfig.ticketCategory) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("The ticket system category folder has not been configured yet.").setColor(0xE67E22)], ephemeral: true });

        if (cooldowns.has(interaction.user.id)) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Please wait a moment before trying to open another ticket.").setColor(0xE67E22)], ephemeral: true });
        cooldowns.set(interaction.user.id, Date.now() + 18000);
        setTimeout(() => cooldowns.delete(interaction.user.id), 18000);

        await interaction.deferReply({ ephemeral: true });
        serverConfig.ticketCount = (serverConfig.ticketCount || 0) + 1;
        saveDB();

        const channel = await guild.channels.create({
            name: `ticket-${type}-${String(serverConfig.ticketCount).padStart(4, '0')}`,
            type: ChannelType.GuildText,
            parent: serverConfig.ticketCategory,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
            ]
        });

        await channel.send({ content: `${interaction.user}`, embeds: [new EmbedBuilder().setTitle("Support Ticket Opened").setDescription("A staff member will be with you shortly. Please explain your issue in detail here.").setColor(0x3498DB)] });
        return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Your ticket has been opened in channel: ${channel}`).setColor(0x3498DB)] });
    }
});

client.login(TOKEN);