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

const CONFIG_FILE = './config.json';
let config = {};

if (fs.existsSync(CONFIG_FILE)) {
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) {
        console.error("Could not parse config.json file.");
    }
}

const TOKEN = process.env.TOKEN || config.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || config.CLIENT_ID;
const OWNER_ID = config.OWNER_ID; 
const VERIFIED_ROLE_NAME = process.env.VERIFIED_ROLE_NAME || config.VERIFIED_ROLE_NAME || "Verified";
const PROTECTED_USERS = config.QUARANTINE_PROTECTED_IDS || [];

if (!TOKEN) {
    console.error("Error: Bot token is missing.");
    process.exit(1);
}

let slashCommandsData = [];
const commandsPath = path.join(__dirname, 'commands.js');

if (fs.existsSync(commandsPath)) {
    try {
        slashCommandsData = require(commandsPath);
    } catch (err) {
        console.error("Error loading commands.js:", err);
        process.exit(1);
    }
}

const DB_FILE = './database.json';
const cooldowns = new Map();

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
    console.log(`Logged in as ${client.user.tag}`);
    try {
        const restInstance = new REST({ version: '10' }).setToken(TOKEN);
        await restInstance.put(Routes.applicationCommands(CLIENT_ID), { body: slashCommandsData });
    } catch (e) { console.error("Failed to register commands:", e); }
});

client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    
    const serverConfig = db[message.guild.id];
    const authorAdminLevel = getAdminLevel(message.guild, message.member);

    if (message.content.trim().toLowerCase() === '!leave') {
        if (!OWNER_ID || message.author.id !== String(OWNER_ID)) {
            await message.reply({
                embeds: [new EmbedBuilder()
                    .setDescription("Access Denied: Only the bot owner can use this command.")
                    .setColor('#E67E22')]
            }).catch(() => {});
            return;
        }

        await message.reply({
            embeds: [new EmbedBuilder()
                .setTitle("Leaving Server")
                .setDescription("Owner identity verified. Leaving this server now.")
                .setColor('#2F619E')]
        }).catch(() => {});

        try {
            await message.guild.leave();
            return;
        } catch (err) {
            console.error("Error leaving guild:", err);
            return;
        }
    }

    if (authorAdminLevel < 1) { 
        const pingsOwner = message.mentions.users.has(message.guild.ownerId);
        const containsProtectedPing = message.mentions.users.some(user => PROTECTED_USERS.includes(user.id));
        
        if (pingsOwner || containsProtectedPing) {
            try {
                await message.delete().catch(() => {}); 
                await message.member.timeout(24 * 60 * 60 * 1000, "Mentioned a protected user.").catch(() => {});
                
                await message.author.send({
                    embeds: [new EmbedBuilder()
                        .setTitle("Muted")
                        .setDescription(`You have been muted in ${message.guild.name} for mentioning a high-clearance profile.`)
                        .setColor('#E67E22')]
                }).catch(() => {});

                if (serverConfig && serverConfig.logChannelId) {
                    const logs = await message.guild.channels.fetch(serverConfig.logChannelId).catch(() => null);
                    if (logs) {
                        const alert = new EmbedBuilder()
                            .setTitle("Protected User Mentioned")
                            .setDescription(`User: ${message.author}\nAction: Message deleted, 24-hour timeout applied.`)
                            .setColor('#E67E22');
                        await logs.send({ embeds: [alert] });
                    }
                }
                return; 
            } catch (e) { console.error(e); }
        }
    }

    if (serverConfig && serverConfig.security && serverConfig.security.antiPingEnabled) {
        const maxMentionsAllowed = serverConfig.security.antiPingMaxPings || 5;
        const totalMentions = message.mentions.users.size + message.mentions.roles.size;
        
        if (totalMentions > maxMentionsAllowed) {
            if (authorAdminLevel >= 1) return; 

            try {
                await message.delete().catch(() => {});
                await message.member.timeout(30 * 60 * 1000, "Anti-ping limit reached.").catch(() => {});
                
                if (serverConfig.logChannelId) {
                    const logs = await message.guild.channels.fetch(serverConfig.logChannelId).catch(() => null);
                    if (logs) {
                        const alert = new EmbedBuilder()
                            .setTitle("Anti-Ping Triggered")
                            .setDescription(`${message.author.tag} was muted for 30 minutes (Sent ${totalMentions} pings).`)
                            .setColor('#E67E22');
                        await logs.send({ embeds: [alert] });
                    }
                }
            } catch (e) { console.error(e); }
        }
    }
});

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
            const profileResult = await request(`https://users.roblox.com/v1/users/${user.id}`);
            const profileData = await profileResult.body.json();
            return { id: user.id, username: user.requestedUsername || user.name, description: profileData.description || "" };
        }
    } catch (e) { console.error(e); }
    return null;
}

async function getRobloxUserById(userId) {
    try {
        const profileResult = await request(`https://users.roblox.com/v1/users/${userId}`);
        const profileData = await profileResult.body.json();
        if (profileData && profileData.id) {
            return { id: profileData.id, username: profileData.name, description: profileData.description || "" };
        }
    } catch (e) { console.error(e); }
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
    } catch (e) { console.error(e); }
    return 0;
}

async function executeUserUpdate(interaction, member, serverConfig) {
    let robloxUser = null;
    if (db.globalVerifiedUsers && db.globalVerifiedUsers[member.id]) robloxUser = await getRobloxUserById(db.globalVerifiedUsers[member.id]);
    if (!robloxUser) robloxUser = await getRobloxUser((member.nickname || member.user.username).replace(/^\[[^\]]+\]\s*/, '').trim());
    
    if (!robloxUser) {
        const errEmbed = new EmbedBuilder().setDescription("Could not find your linked Roblox profile. Match your name and try again.").setColor('#E67E22');
        return interaction.deferred || interaction.replied ? interaction.editReply({ embeds: [errEmbed] }) : interaction.reply({ embeds: [errEmbed], ephemeral: true });
    }

    if (!db.globalVerifiedUsers) db.globalVerifiedUsers = {};
    db.globalVerifiedUsers[member.id] = robloxUser.id;
    saveDB();

    const rankValue = await getRobloxUserRank(robloxUser.id, serverConfig.groupId);
    if (rankValue === 0) {
        const groupErr = new EmbedBuilder().setTitle("Verification Denied").setDescription(`You are not in the Roblox Group (ID: \`${serverConfig.groupId}\`).`).setColor('#E67E22');
        return interaction.deferred || interaction.replied ? interaction.editReply({ embeds: [groupErr] }) : interaction.reply({ embeds: [groupErr], ephemeral: true });
    }

    const bindConfig = serverConfig.binds ? serverConfig.binds[String(rankValue)] : null;
    let assignedPrefix = "None";
    let targetRoleId = null;

    if (bindConfig) {
        assignedPrefix = bindConfig.prefix ? `[${bindConfig.prefix.replace(/[\[\]]/g, '')}]` : "None";
        targetRoleId = bindConfig.roleId || null;
    }

    const formatPrefix = assignedPrefix !== "None" ? `${assignedPrefix} ` : "";
    await member.setNickname(`${formatPrefix}${robloxUser.username}`.substring(0, 32)).catch(() => {});
    
    const verifiedRole = interaction.guild.roles.cache.find(r => r.name === VERIFIED_ROLE_NAME);
    if (verifiedRole) await member.roles.add(verifiedRole).catch(() => {});

    let rolesAddedText = "None";
    let rolesRemovedText = "None";

    if (targetRoleId) {
        if (!member.roles.cache.has(targetRoleId)) {
            await member.roles.add(targetRoleId).catch(() => {});
            rolesAddedText = `<@&${targetRoleId}>`;
        }
        for (const [rId, bind] of Object.entries(serverConfig.binds || {})) {
            if (parseInt(rId, 10) !== rankValue && bind.roleId && member.roles.cache.has(bind.roleId)) {
                await member.roles.remove(bind.roleId).catch(() => {});
                rolesRemovedText = `<@&${bind.roleId}>`;
            }
        }
    }

    const responseEmbed = new EmbedBuilder()
        .setTitle("Profile Synced")
        .setDescription(`Successfully updated verified data for **${robloxUser.username}**.`)
        .addFields(
            { name: "Prefix Applied", value: `\`${assignedPrefix}\``, inline: true },
            { name: "Group Rank ID", value: `\`${rankValue}\``, inline: true },
            { name: "Roles Granted", value: rolesAddedText, inline: false },
            { name: "Roles Removed", value: rolesRemovedText, inline: false }
        )
        .setColor('#2F619E'); 

    return interaction.deferred || interaction.replied ? interaction.editReply({ embeds: [responseEmbed] }) : interaction.reply({ embeds: [responseEmbed], ephemeral: true });
}

// --- OPEN TICKET HELPER FUNCTION ---
async function handleTicketGeneration(interaction, type, serverConfig, guild) {
    if (!serverConfig.ticketCategory) {
        return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Ticket system configuration error.").setColor('#E67E22')], ephemeral: true });
    }

    if (cooldowns.has(interaction.user.id)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Please wait before opening another ticket.").setColor('#E67E22')], ephemeral: true });
    }
    cooldowns.set(interaction.user.id, Date.now() + 10000);

    await interaction.deferReply({ ephemeral: true });
    serverConfig.ticketCount = (serverConfig.ticketCount || 0) + 1;
    saveDB();

    const channel = await guild.channels.create({
        name: `ticket-${type}-${String(serverConfig.ticketCount).padStart(4, '0')}`,
        type: ChannelType.GuildText,
        parent: serverConfig.ticketCategory,
        permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
    });

    await channel.send({ content: `${interaction.user}`, embeds: [new EmbedBuilder().setTitle("Ticket Opened").setDescription("Please describe your issue here.").setColor('#2F619E')] });
    return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Your ticket has been created: ${channel}`).setColor('#2F619E')] });
}

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
        
        if (interaction.commandName === 'send-panel') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && callerAdminLevel === 0) {
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("You do not have permission to use this command.").setColor('#E67E22')], ephemeral: true });
            }

            const verificationPanelEmbed = new EmbedBuilder()
                .setTitle("BRITISH ARMY VERIFICATION SYSTEM V5")
                .setDescription("Press the buttons below to verify your ROBLOX account or access our help desks.")
                .setColor('#2F619E'); 

            const actionButtonsRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_roblox_login').setLabel('Verify via ROBLOX Login').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('ticket_btn_verification').setLabel('Verify via Verification Tickets').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('panel_update_roles').setLabel('Update Roles').setStyle(ButtonStyle.Success)
            );

            await interaction.channel.send({ embeds: [verificationPanelEmbed], components: [actionButtonsRow] });
            return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Verification panel posted.").setColor('#2F619E')], ephemeral: true });
        }

        if (interaction.commandName === 'security') {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'anti-ping') {
                if (callerAdminLevel < 7) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access Denied. Higher clearance required.").setColor('#E67E22')], ephemeral: true });
                serverConfig.security.antiPingEnabled = interaction.options.getBoolean('enabled');
                serverConfig.security.antiPingMaxPings = interaction.options.getInteger('max-pings') || 5;
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Anti-ping configurations updated.`).setColor('#2F619E')] });
            }
        }

        if (interaction.commandName === 'admin') {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'view') {
                let userLines = []; let roleLines = [];
                if (serverConfig.adminUsers) Object.entries(serverConfig.adminUsers).forEach(([uId, v]) => userLines.push(`<@${uId}> - Level ${v}`));
                if (serverConfig.adminRoles) Object.entries(serverConfig.adminRoles).forEach(([rId, v]) => roleLines.push(`<@&${rId}> - Level ${v}`));
                return interaction.reply({ embeds: [new EmbedBuilder().setTitle("Admin Clearance").addFields({ name: "Users", value: userLines.join("\n") || "None" }, { name: "Roles", value: roleLines.join("\n") || "None" }).setColor('#2F619E')] });
            }
            if (callerAdminLevel === 0) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Unauthorized action.").setColor('#E67E22')], ephemeral: true });
            if (subcommand === 'add') {
                const lvl = interaction.options.getInteger('level');
                if (lvl >= callerAdminLevel) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Cannot assign a level higher than your own.").setColor('#E67E22')], ephemeral: true });
                const tu = interaction.options.getUser('user'); const tr = interaction.options.getRole('role');
                if (tu) serverConfig.adminUsers[tu.id] = lvl; if (tr) serverConfig.adminRoles[tr.id] = lvl;
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Admin levels updated.").setColor('#2F619E')] });
            }
        }

        if (interaction.commandName === 'rankbinds') {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'view') {
                let lines = [];
                if (serverConfig.binds) Object.entries(serverConfig.binds).forEach(([rId, d]) => lines.push(`**Rank ${rId}**: <@&${d.roleId}> [${d.prefix || "None"}]`));
                return interaction.reply({ embeds: [new EmbedBuilder().setTitle("Rank Mappings").setDescription(lines.join("\n") || "No bindings configured.").setColor('#2F619E')] });
            }
            if (callerAdminLevel === 0) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access denied.").setColor('#E67E22')], ephemeral: true });
            if (subcommand === 'add') {
                serverConfig.groupId = interaction.options.getInteger('groupid');
                if (!serverConfig.binds) serverConfig.binds = {};
                serverConfig.binds[String(interaction.options.getInteger('rankid'))] = { prefix: interaction.options.getString('prefix'), roleId: interaction.options.getRole('role').id };
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Rank binding rule added.").setColor('#2F619E')] });
            }
        }

        if (interaction.commandName === 'ticket') {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'configure') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && callerAdminLevel === 0) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Missing permissions.").setColor('#E67E22')], ephemeral: true });
                serverConfig.ticketCategory = interaction.options.getChannel('category').id;
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Ticket category setup updated.").setColor('#2F619E')] });
            }
            if (subcommand === 'panel') {
                const type = interaction.options.getString('type');
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_btn_${type}`).setLabel('Open Ticket').setStyle(ButtonStyle.Danger));
                await interaction.channel.send({ embeds: [new EmbedBuilder().setTitle(`${type.toUpperCase()} SUPPORT`).setDescription("Click below to start a help ticket.").setColor('#2F619E')], components: [row] });
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Support panel posted.").setColor('#2F619E')], ephemeral: true });
            }
        }

        if (['warn', 'mute', 'unmute', 'ban'].includes(interaction.commandName)) {
            if (callerAdminLevel === 0) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access Denied.").setColor('#E67E22')], ephemeral: true });
            const targetUser = interaction.options.getUser('user'); const reason = interaction.options.getString('reason') || "No reason specified.";
            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!targetMember) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Target member not found.").setColor('#E67E22')], ephemeral: true });

            if (interaction.commandName === 'mute') {
                const durationMs = parseDuration(interaction.options.getString('duration'));
                if (!durationMs) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Invalid format. Use 30m, 2h, 1d.").setColor('#E67E22')], ephemeral: true });
                await targetMember.timeout(durationMs, reason);
            } else if (interaction.commandName === 'ban') {
                await targetMember.ban({ reason });
            }
            return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Action completed successfully against ${targetUser.tag}.`).setColor('#2F619E')] });
        }

        if (interaction.commandName === 'update') {
            if (!serverConfig.groupId) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Roblox systems are not linked.").setColor('#E67E22')], ephemeral: true });
            await interaction.deferReply();
            return executeUserUpdate(interaction, member, serverConfig);
        }
    }

    if (interaction.isButton()) {
        // Handle Roblox verification interaction via the main panel button
        if (interaction.customId === 'panel_roblox_login' || interaction.customId === 'panel_update_roles') {
            if (!serverConfig.groupId) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Roblox systems are not linked.").setColor('#E67E22')], ephemeral: true });
            return executeUserUpdate(interaction, member, serverConfig);
        }

        // Handle verification ticket from the main panel button
        if (interaction.customId === 'ticket_btn_verification') {
            return handleTicketGeneration(interaction, 'verification', serverConfig, guild);
        }

        // Handle custom stand-alone ticket panels created using the /ticket panel command
        if (interaction.customId.startsWith('ticket_btn_')) {
            const type = interaction.customId.replace('ticket_btn_', '');
            return handleTicketGeneration(interaction, type, serverConfig, guild);
        }
    }
});

client.login(TOKEN);