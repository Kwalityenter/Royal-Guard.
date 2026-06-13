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
const OWNER_ID = config.OWNER_ID; 
const VERIFIED_ROLE_NAME = process.env.VERIFIED_ROLE_NAME || config.VERIFIED_ROLE_NAME || "Verified";
const PROTECTED_USERS = config.QUARANTINE_PROTECTED_IDS || [];
const ROYAL_GUARD_LOGO = "https://i.imgur.com/your-uploaded-crest-image.png"; 

if (!TOKEN) {
    console.error("Critical Error: The application token is missing from your environment or configuration.");
    process.exit(1);
}

// ----------------- SAFE COMMAND INTERACTION IMPORT -----------------
let slashCommandsData = [];
const commandsPath = path.join(__dirname, 'commands.js');

if (fs.existsSync(commandsPath)) {
    try {
        slashCommandsData = require(commandsPath);
    } catch (err) {
        console.error("CRITICAL EXCEPTION: An error occurred inside your commands.js loader core:");
        console.error(err);
        process.exit(1);
    }
} else {
    console.error(`CRITICAL: A commands.js file could not be discovered at location: ${commandsPath}`);
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

function createBrandedEmbed() {
    return new EmbedBuilder()
        .setAuthor({ name: "Royal Guard", iconURL: ROYAL_GUARD_LOGO })
        .setFooter({ text: "Royal Guard System Core", iconURL: ROYAL_GUARD_LOGO })
        .setTimestamp()
        .setColor('#2F619E');
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
        await restInstance.put(Routes.applicationCommands(CLIENT_ID), { body: slashCommandsData });
    } catch (e) { console.error("Failed to register global application commands:", e); }
});

// ----------------- TEXT COMMAND & SECURITY LISTENER -----------------
client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    
    const serverConfig = db[message.guild.id];
    const authorAdminLevel = getAdminLevel(message.guild, message.member);

    // --- MASTER RESTRICTED TEXT !LEAVE COMMAND ---
    if (message.content.trim().toLowerCase() === '!leave') {
        // Absolute identity lock checking against your config configuration file
        if (!OWNER_ID || message.author.id !== OWNER_ID) {
            return message.reply({
                embeds: [createBrandedEmbed()
                    .setDescription("❌ **System Override Denied:** This command is hard-locked to the bot's master developer profile.")
                    .setColor('#D9534F')]
            });
        }

        await message.reply({
            embeds: [createBrandedEmbed()
                .setTitle("⚠️ Disconnecting From Guild")
                .setDescription("Master signature verified. The Royal Guard system is safely leaving this server installation.")
                .setColor('#E67E22')]
        }).catch(() => {});

        try {
            return await message.guild.leave();
        } catch (err) {
            console.error("An error occurred while attempting to leave the guild:", err);
        }
    }

    // --- ANTI-PING PROTOCOLS ---
    if (authorAdminLevel < 1) { 
        const pingsOwner = message.mentions.users.has(message.guild.ownerId);
        const containsProtectedPing = message.mentions.users.some(user => PROTECTED_USERS.includes(user.id));
        
        if (pingsOwner || containsProtectedPing) {
            try {
                await message.delete().catch(() => {}); 
                await message.member.timeout(24 * 60 * 60 * 1000, "Security System: Direct mention sent to a protected profile.").catch(() => {});
                
                await message.author.send({
                    embeds: [createBrandedEmbed()
                        .setTitle("⚠️ Security Containment Notice")
                        .setDescription(`You have been instantly muted in **${message.guild.name}** for tagging a high-clearance profile.`)
                        .setColor('#E67E22')]
                }).catch(() => {});

                if (serverConfig && serverConfig.logChannelId) {
                    const logs = await message.guild.channels.fetch(serverConfig.logChannelId).catch(() => null);
                    if (logs) {
                        const alert = createBrandedEmbed()
                            .setTitle("🔒 CRITICAL PROFILE PING VIOLATION")
                            .setDescription(`**Account Instantly Silenced**\n\n• **User:** ${message.author}\n• **Action:** Message purged, **24 Hour Timeout** applied.`)
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
                await message.member.timeout(30 * 60 * 1000, "Anti-Ping protection flag limit reached.").catch(() => {});
                
                if (serverConfig.logChannelId) {
                    const logs = await message.guild.channels.fetch(serverConfig.logChannelId).catch(() => null);
                    if (logs) {
                        const alert = createBrandedEmbed()
                            .setTitle("Anti-Ping Protection Triggered")
                            .setDescription(`User ${message.author.tag} muted for 30 minutes (Sent ${totalMentions} pings).`)
                            .setColor('#E67E22');
                        await logs.send({ embeds: [alert] });
                    }
                }
            } catch (e) { console.error(e); }
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
        const errEmbed = createBrandedEmbed().setDescription("Could not find your linked Roblox profile. Ensure your name matches, then try again.").setColor('#E67E22');
        return interaction.deferred || interaction.replied ? interaction.editReply({ embeds: [errEmbed] }) : interaction.reply({ embeds: [errEmbed], ephemeral: true });
    }

    if (!db.globalVerifiedUsers) db.globalVerifiedUsers = {};
    db.globalVerifiedUsers[member.id] = robloxUser.id;
    saveDB();

    const rankValue = await getRobloxUserRank(robloxUser.id, serverConfig.groupId);
    if (rankValue === 0) {
        const groupErr = createBrandedEmbed().setTitle("Verification Denied").setDescription(`You are not a member of our Roblox Group (ID: \`${serverConfig.groupId}\`).`).setColor('#E67E22');
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

    const responseEmbed = createBrandedEmbed()
        .setTitle("Profile Settings Synchronized")
        .setDescription(`Successfully verified data tables for **${robloxUser.username}**.`)
        .addFields(
            { name: "Prefix Applied", value: `\`${assignedPrefix}\``, inline: true },
            { name: "Group Rank ID", value: `\`${rankValue}\``, inline: true },
            { name: "Granted Roles", value: rolesAddedText, inline: false },
            { name: "Removed Roles", value: rolesRemovedText, inline: false }
        );

    return interaction.deferred || interaction.replied ? interaction.editReply({ embeds: [responseEmbed] }) : interaction.reply({ embeds: [responseEmbed], ephemeral: true });
}

// ----------------- BOT COMMAND/INTERACTION RUNNER -----------------
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
                return interaction.reply({ embeds: [createBrandedEmbed().setDescription("You lack system authority to deploy this module.").setColor('#D9534F')], ephemeral: true });
            }

            const verificationPanelEmbed = new EmbedBuilder()
                .setAuthor({ name: "Royal Guard", iconURL: ROYAL_GUARD_LOGO })
                .setTitle("BRITISH ARMY VERIFICATION SYSTEM V5")
                .setDescription("Press the **Verify / Reverify** button to verify or reverify your ROBLOX account.")
                .setThumbnail(ROYAL_GUARD_LOGO) 
                .setFooter({ text: "Royal Guard System Core", iconURL: ROYAL_GUARD_LOGO })
                .setColor('#2F619E');

            const actionButtonsRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_roblox_login').setLabel('Verify via ROBLOX Login').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('ticket_btn_verification').setLabel('Verify via Verification Tickets').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('panel_update_roles').setLabel('Update Roles').setStyle(ButtonStyle.Success)
            );

            await interaction.channel.send({ embeds: [verificationPanelEmbed], components: [actionButtonsRow] });
            return interaction.reply({ embeds: [createBrandedEmbed().setDescription("System portal panel deployed successfully.")], ephemeral: true });
        }

        if (interaction.commandName === 'security') {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'anti-ping') {
                if (callerAdminLevel < 7) return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Access Denied. Level 7 clearance required.").setColor('#D9534F')], ephemeral: true });
                serverConfig.security.antiPingEnabled = interaction.options.getBoolean('enabled');
                serverConfig.security.antiPingMaxPings = interaction.options.getInteger('max-pings') || 5;
                saveDB();
                return interaction.reply({ embeds: [createBrandedEmbed().setDescription(`Anti-ping configurations adjusted.`)] });
            }
        }

        if (interaction.commandName === 'admin') {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'view') {
                let userLines = []; let roleLines = [];
                if (serverConfig.adminUsers) Object.entries(serverConfig.adminUsers).forEach(([uId, v]) => userLines.push(`<@${uId}> - Level ${v}`));
                if (serverConfig.adminRoles) Object.entries(serverConfig.adminRoles).forEach(([rId, v]) => roleLines.push(`<@&${rId}> - Level ${v}`));
                return interaction.reply({ embeds: [createBrandedEmbed().setTitle("Clearance Metrics").addFields({ name: "Users", value: userLines.join("\n") || "None" }, { name: "Roles", value: roleLines.join("\n") || "None" })] });
            }
            if (callerAdminLevel === 0) return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Unauthorized hierarchy adjust error.").setColor('#D9534F')], ephemeral: true });
            if (subcommand === 'add') {
                const lvl = interaction.options.getInteger('level');
                if (lvl >= callerAdminLevel) return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Cannot assign ranks higher than your own.").setColor('#D9534F')], ephemeral: true });
                const tu = interaction.options.getUser('user'); const tr = interaction.options.getRole('role');
                if (tu) serverConfig.adminUsers[tu.id] = lvl; if (tr) serverConfig.adminRoles[tr.id] = lvl;
                saveDB();
                return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Clearance permissions updated.")] });
            }
        }

        if (interaction.commandName === 'rankbinds') {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'view') {
                let lines = [];
                if (serverConfig.binds) Object.entries(serverConfig.binds).forEach(([rId, d]) => lines.push(`**Rank ${rId}**: <@&${d.roleId}> [${d.prefix || "None"}]`));
                return interaction.reply({ embeds: [createBrandedEmbed().setTitle("Mapping Layout").setDescription(lines.join("\n") || "No bindings configured.")] });
            }
            if (callerAdminLevel === 0) return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Administrative access required.").setColor('#D9534F')], ephemeral: true });
            if (subcommand === 'add') {
                serverConfig.groupId = interaction.options.getInteger('groupid');
                if (!serverConfig.binds) serverConfig.binds = {};
                serverConfig.binds[String(interaction.options.getInteger('rankid'))] = { prefix: interaction.options.getString('prefix'), roleId: interaction.options.getRole('role').id };
                saveDB();
                return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Binding array rule appended.")] });
            }
        }

        if (interaction.commandName === 'ticket') {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'configure') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && callerAdminLevel === 0) return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Missing clearance.").setColor('#D9534F')], ephemeral: true });
                serverConfig.ticketCategory = interaction.options.getChannel('category').id;
                saveDB();
                return interaction.reply({ embeds: [createBrandedEmbed().setDescription("System category updated.")] });
            }
            if (subcommand === 'panel') {
                const type = interaction.options.getString('type');
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_btn_${type}`).setLabel('Create Ticket').setStyle(ButtonStyle.Danger));
                await interaction.channel.send({ embeds: [createBrandedEmbed().setTitle(`${type.toUpperCase()} DISPATCH HUB`).setDescription("Click to open a support sequence.")], components: [row] });
                return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Panel posted.")], ephemeral: true });
            }
        }

        if (['warn', 'mute', 'unmute', 'ban'].includes(interaction.commandName)) {
            if (callerAdminLevel === 0) return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Clearance required.").setColor('#D9534F')], ephemeral: true });
            const targetUser = interaction.options.getUser('user'); const reason = interaction.options.getString('reason') || "No reason specified.";
            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!targetMember) return interaction.reply({ embeds: [createBrandedEmbed().setDescription("User not found.").setColor('#D9534F')], ephemeral: true });

            if (interaction.commandName === 'mute') {
                const durationMs = parseDuration(interaction.options.getString('duration'));
                if (!durationMs) return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Invalid format. Use 30m, 2h, 1d.").setColor('#D9534F')], ephemeral: true });
                await targetMember.timeout(durationMs, reason);
            } else if (interaction.commandName === 'ban') {
                await targetMember.ban({ reason });
            }
            return interaction.reply({ embeds: [createBrandedEmbed().setDescription(`Moderation task executed against ${targetUser.tag}.`)] });
        }

        if (interaction.commandName === 'update') {
            if (!serverConfig.groupId) return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Roblox systems not bound.").setColor('#D9534F')], ephemeral: true });
            await interaction.deferReply();
            return executeUserUpdate(interaction, member, serverConfig);
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'panel_update_roles') {
            if (!serverConfig.groupId) return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Roblox systems not bound.").setColor('#D9534F')], ephemeral: true });
            return executeUserUpdate(interaction, member, serverConfig);
        }

        if (interaction.customId.startsWith('ticket_btn_')) {
            const type = interaction.customId.replace('ticket_btn_', '');
            if (!serverConfig.ticketCategory) return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Ticket structure configuration error.").setColor('#D9534F')], ephemeral: true });

            if (cooldowns.has(interaction.user.id)) return interaction.reply({ embeds: [createBrandedEmbed().setDescription("Throttling request. Please slow down.").setColor('#D9534F')], ephemeral: true });
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

            await channel.send({ content: `${interaction.user}`, embeds: [createBrandedEmbed().setTitle("Support Channel Instance").setDescription("Please state your inquiry.")] });
            return interaction.editReply({ embeds: [createBrandedEmbed().setDescription(`Ticket generated: ${channel}`)] });
        }
    }
});

client.login(TOKEN);