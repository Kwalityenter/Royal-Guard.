const { 
    Client, 
    GatewayIntentBits, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ChannelType,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    PermissionsBitField
} = require('discord.js');
const { request } = require('undici');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');

const DB_FILE = './database.json';
const WORD_POOL = ["pizza", "right", "verification", "army", "left", "blue", "robot", "down", "cheese", "yes", "up", "green", "tiger"];
const cooldowns = new Map(); // Tracks ticket creation cooldowns (18s)

// ----------------- DATABASE UTILITIES -----------------
let db = {};
if (!fs.existsSync(DB_FILE)) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 2), 'utf8');
        console.log("Database file created.");
    } catch (err) {
        console.error("Database error:", err);
    }
} else {
    try {
        const content = fs.readFileSync(DB_FILE, 'utf8').trim();
        db = content ? JSON.parse(content) : {};
    } catch (err) {
        console.error("Corrupted database detected, resetting file.");
        db = {};
    }
}

function saveDB() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (err) {
        console.error("Failed to save database:", err);
    }
}

function getAdminLevel(guild, member) {
    if (guild.ownerId === member.id) return 8; // Level 8: Server Owner
    
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

function formatDurationString(str) {
    if (!str) return "Permanent";
    const match = str.match(/^(\d+)([mhwd])$/i);
    if (!match) return str;
    const value = match[1];
    const unit = match[2].toLowerCase();
    const unitNames = { m: 'minute', h: 'hour', d: 'day', w: 'week' };
    return `${value} ${unitNames[unit]}${parseInt(value, 10) !== 1 ? 's' : ''}`;
}

// Fixed to dynamically present OAuth2 network metadata structures seen in verification logs
async function sendVerificationLog(guild, member, robloxUser, method, oauthData = null) {
    const serverConfig = db[guild.id];
    if (!serverConfig || !serverConfig.logChannelId) return;

    const logChannel = await guild.channels.fetch(serverConfig.logChannelId).catch(() => null);
    if (!logChannel) return;

    let logDescription = 
        `**Discord:** ${member} | \`${member.user.tag}\` (\`${member.id}\`)\n` +
        `**ROBLOX:** \`${robloxUser.username}\` | https://www.roblox.com/users/${robloxUser.id}/profile\n` +
        `**Method:** ${method}`;

    if (method === "OAuth2" && oauthData) {
        logDescription += 
            `\n\n**IP:** ${oauthData.ip || "N/A"}\n` +
            `**Country:** ${oauthData.country || "N/A"}\n` +
            `**Country Code:** ${oauthData.countryCode || "N/A"}\n` +
            `**Region:** ${oauthData.region || "N/A"}\n` +
            `**Latitude:** ${oauthData.latitude || "N/A"}\n` +
            `**Longitude:** ${oauthData.longitude || "N/A"}\n` +
            `**Internet Service Provider:** ${oauthData.isp || "N/A"}`;
    }

    const logEmbed = new EmbedBuilder()
        .setTitle("Verification Logs")
        .setDescription(logDescription)
        .setColor(0x2B2D31)
        .setTimestamp();

    await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
}

// ----------------- CLIENT INITIALIZATION -----------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const commands = [
    new SlashCommandBuilder()
        .setName('rankbinds')
        .setDescription('Bind a Roblox Group Rank ID to a Discord Nickname Prefix and Role')
        .addIntegerOption(option => option.setName('groupid').setDescription('The Roblox Group ID').setRequired(true))
        .addIntegerOption(option => option.setName('rankid').setDescription('The Roblox Rank ID (1-255)').setRequired(true))
        .addStringOption(option => option.setName('prefix').setDescription('The prefix to apply, e.g., [OR-1]').setRequired(true))
        .addRoleOption(option => option.setName('role').setDescription('The Discord role to give for this rank').setRequired(true)),
            
    new SlashCommandBuilder()
        .setName('update')
        .setDescription('Update your server nickname and roles based on your Roblox Group rank'),

    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Manage custom bot administrators and level clearance keys')
        .addSubcommand(sub => 
            sub.setName('add')
               .setDescription('Add a role or individual user as a bot administrator')
               .addIntegerOption(opt => opt.setName('level').setDescription('Clearance authorization level (1-7)').setRequired(true).setMinValue(1).setMaxValue(7))
               .addUserOption(opt => opt.setName('user').setDescription('Target user to authorize').setRequired(false))
               .addRoleOption(opt => opt.setName('role').setDescription('Target role to authorize').setRequired(false)))
        .addSubcommand(sub => 
            sub.setName('delete')
               .setDescription('Remove a role or user from bot administration privileges')
               .addUserOption(opt => opt.setName('user').setDescription('Target user to remove').setRequired(false))
               .addRoleOption(opt => opt.setName('role').setDescription('Target role to remove').setRequired(false))),

    new SlashCommandBuilder()
        .setName('verification-logs')
        .setDescription('Set up the logging channel for verification occurrences')
        .addChannelOption(opt => 
            opt.setName('channel')
               .setDescription('Select the target text channel for tracking logs')
               .setRequired(true)
               .addChannelTypes(ChannelType.GuildText)),

    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Issue an official warning record log to a server user')
        .addUserOption(opt => opt.setName('user').setDescription('Target member to warn').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Contextual reasoning explanation').setRequired(true)),

    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout/Mute a specific member inside the guild')
        .addUserOption(opt => opt.setName('user').setDescription('Target member to mute').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('Length parameters, e.g., 30m, 3h, 1d').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Contextual reasoning explanation').setRequired(true)),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Permanently sever access permissions and ban a member from the server')
        .addUserOption(opt => opt.setName('user').setDescription('Target member to ban').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Contextual reasoning explanation').setRequired(true)),

    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Manage and configure the Royal Guard ticket environment.')
        .addSubcommand(sub =>
            sub.setName('configure')
               .setDescription('Configure ticket parameters for this guild.')
               .addChannelOption(opt => opt.setName('category').setDescription('The category layout where tickets are created.').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('add')
               .setDescription('Adds a user to the current ticket channel.')
               .addUserOption(opt => opt.setName('target').setDescription('The user to add to this ticket channel.').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('panel')
               .setDescription('Send a modern interactive ticket portal dashboard panel.')
               .addStringOption(opt => 
                    opt.setName('type')
                       .setDescription('Select the layout style for the system panel.')
                       .setRequired(true)
                       .addChoices(
                           { name: 'Report Tickets Panel', value: 'report' },
                           { name: 'Other Tickets Panel', value: 'other' }
                       ))
        )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(config.TOKEN);

client.on('error', error => console.error('Bot Error:', error));
client.on('shardError', (error, shardId) => console.error(`Shard ${shardId} disconnected:`, error));
process.on('unhandledRejection', error => console.error('Unhandled Promise Rejection:', error));

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// ----------------- ROBLOX CORE -----------------
function generateVerificationCode() {
    return [...WORD_POOL].sort(() => 0.5 - Math.random()).slice(0, 6).join(' ');
}

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
            
            return { 
                id: userId, 
                username: user.requestedUsername || user.name, 
                description: profileData.description || "" 
            };
        }
    } catch (e) { console.error('Roblox Profile Lookup Error:', e); }
    return null;
}

async function getRobloxUserById(userId) {
    try {
        const profileResult = await request(`https://users.roblox.com/v1/users/${userId}`);
        const profileData = await profileResult.body.json();
        if (profileData && profileData.id) {
            return {
                id: profileData.id,
                username: profileData.name,
                description: profileData.description || ""
            };
        }
    } catch (e) { console.error('Roblox ID Lookup Error:', e); }
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
    } catch (e) { console.error('Roblox Group Rank Error:', e); }
    return 0;
}

// ----------------- INTERACTION HANDLING -----------------
client.on('interactionCreate', async interaction => {
    const guild = interaction.guild;
    const member = interaction.member;

    if (!guild) return;

    if (!db[guild.id]) {
        db[guild.id] = { groupId: null, binds: {}, verifiedUsers: {}, adminUsers: {}, adminRoles: {}, ticketCategory: null, ticketCount: 0 };
    }
    if (!db[guild.id].adminUsers) db[guild.id].adminUsers = {};
    if (!db[guild.id].adminRoles) db[guild.id].adminRoles = {};
    
    const serverConfig = db[guild.id];
    const callerAdminLevel = getAdminLevel(guild, member);

    if (interaction.isChatInputCommand()) {
        
        // --- /TICKET COMMAND SYSTEM ---
        if (interaction.commandName === 'ticket') {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'configure') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && callerAdminLevel === 0) {
                    return interaction.reply({ content: '❌ You lack system permissions to alter ticket destination categories.', ephemeral: true });
                }
                const category = interaction.options.getChannel('category');
                serverConfig.ticketCategory = category.id;
                saveDB();
                return interaction.reply({ content: `✅ New ticket creation parent category successfully bound to: **${category.name}**`, ephemeral: true });
            }

            if (subcommand === 'add') {
                if (!interaction.channel.name.startsWith('ticket-')) {
                    return interaction.reply({ content: '❌ This command can only be executed inside active ticket channels.', ephemeral: true });
                }
                const target = interaction.options.getUser('target');
                await interaction.channel.permissionOverwrites.edit(target.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
                return interaction.reply({ content: `✅ Added **${target.username}** to this ticket instance.` });
            }

            if (subcommand === 'panel') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && callerAdminLevel === 0) {
                    return interaction.reply({ content: '❌ You lack permissions to deploy system panels.', ephemeral: true });
                }
                const type = interaction.options.getString('type');

                if (type === 'report') {
                    const embed = new EmbedBuilder()
                        .setTitle('REPORT TICKETS')
                        .setDescription('Press the 🚨 **Create Ticket** button for tickets to report an incident or other users.')
                        .setColor(0xBE1E2D);

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('ticket_btn_report').setLabel('Create Ticket').setStyle(ButtonStyle.Danger)
                    );
                    
                    await interaction.channel.send({ embeds: [embed], components: [row] });
                } else if (type === 'other') {
                    const embed = new EmbedBuilder()
                        .setTitle('OTHER TICKETS')
                        .setDescription('Press the 🚨 **Create Ticket** button for tickets regarding other matters.')
                        .setColor(0xBE1E2D);

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('ticket_btn_other').setLabel('Create Ticket').setStyle(ButtonStyle.Danger)
                    );

                    await interaction.channel.send({ embeds: [embed], components: [row] });
                }

                return interaction.reply({ content: '✅ Panel interface framework injected successfully.', ephemeral: true });
            }
        }

        // --- /VERIFICATION-LOGS CONFIGURATION COMMAND ---
        if (interaction.commandName === 'verification-logs') {
            if (callerAdminLevel === 0) {
                const noPerms = new EmbedBuilder().setDescription("You must be an authorized administrator to set logging preferences.").setColor(0xE67E22);
                return interaction.reply({ embeds: [noPerms], ephemeral: true });
            }

            const logChannel = interaction.options.getChannel('channel');
            serverConfig.logChannelId = logChannel.id;
            saveDB();

            const successSetup = new EmbedBuilder()
                .setDescription(`Successfully designated ${logChannel} to output registration and verification server logs.`)
                .setColor(0x3498DB);
            return interaction.reply({ embeds: [successSetup] });
        }

        // --- MODERATION ACTIONS ENGINE (/WARN, /MUTE, /BAN) ---
        if (['warn', 'mute', 'ban'].includes(interaction.commandName)) {
            if (callerAdminLevel === 0) {
                const noPerms = new EmbedBuilder().setDescription("You must be an authorized administrator to manage punishments.").setColor(0xE67E22);
                return interaction.reply({ embeds: [noPerms], ephemeral: true });
            }

            const targetUser = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');
            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

            if (!targetMember) {
                const noUser = new EmbedBuilder().setDescription("This user is not current or present within this guild.").setColor(0xE67E22);
                return interaction.reply({ embeds: [noUser], ephemeral: true });
            }

            const targetAdminLevel = getAdminLevel(guild, targetMember);
            if (targetAdminLevel >= callerAdminLevel) {
                const hierarchyErr = new EmbedBuilder()
                    .setDescription(`Permission Denied. You cannot discipline ${targetUser} because their hierarchy level (${targetAdminLevel}) is equal to or higher than yours (${callerAdminLevel}).`)
                    .setColor(0xE67E22);
                return interaction.reply({ embeds: [hierarchyErr], ephemeral: true });
            }

            if (interaction.commandName === 'warn') {
                const dmEmbed = new EmbedBuilder()
                    .setTitle("Warning Notice")
                    .setDescription(`You have received an official warning inside **${guild.name}**.`)
                    .addFields(
                        { name: "Reason", value: reason },
                        { name: "Action Taken By", value: `${interaction.user.tag}` }
                    )
                    .setColor(0xF1C40F);
                await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

                const channelNotice = new EmbedBuilder()
                    .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
                    .setTitle("Warning Notice")
                    .setDescription(`${targetUser} | \n${targetUser.id} || Was given an official warning for: \`${reason}\``)
                    .setColor(0xF1C40F);

                return interaction.reply({ embeds: [channelNotice] });
            }

            if (interaction.commandName === 'mute') {
                const rawDuration = interaction.options.getString('duration');
                const durationMs = parseDuration(rawDuration);

                if (!durationMs) {
                    const invalidTime = new EmbedBuilder().setDescription("Invalid duration format provided. Please use syntax like `30m`, `3h`, or `1d`.").setColor(0xE67E22);
                    return interaction.reply({ embeds: [invalidTime], ephemeral: true });
                }

                const cleanDurationStr = formatDurationString(rawDuration);

                await targetMember.timeout(durationMs, reason).catch(async err => {
                    console.error(err);
                    return interaction.reply({ content: "Failed to apply timeout due to role permissions.", ephemeral: true });
                });

                const dmEmbed = new EmbedBuilder()
                    .setTitle("Mute Notice")
                    .setDescription(`You have been muted inside **${guild.name}**.`)
                    .addFields(
                        { name: "Duration", value: cleanDurationStr },
                        { name: "Reason", value: reason }
                    )
                    .setColor(0x2B2D31);
                await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

                // Fixed: Aligned layout strings to exactly match production logs (image_b3d849.png)
                const channelNotice = new EmbedBuilder()
                    .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
                    .setTitle("Mute Notice")
                    .setDescription(`${targetUser} |\n${targetUser.id} || Replying or pinging BoD in (${interaction.channel}) and was muted for (${cleanDurationStr})`)
                    .setColor(0x2B2D31);

                return interaction.reply({ embeds: [channelNotice] });
            }

            if (interaction.commandName === 'ban') {
                const dmEmbed = new EmbedBuilder()
                    .setTitle("Ban Notice")
                    .setDescription(`You have been permanently banned from **${guild.name}**.`)
                    .addFields({ name: "Reason", value: reason })
                    .setColor(0xE74C3C);
                
                await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});
                
                await targetMember.ban({ reason: reason }).catch(async err => {
                    console.error(err);
                    return interaction.reply({ content: "Failed to ban target member. Check role hierarchy constraints.", ephemeral: true });
                });

                const channelNotice = new EmbedBuilder()
                    .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
                    .setTitle("Ban Notice")
                    .setDescription(`${targetUser} | \n${targetUser.id} || Has been permanently banned from the server.\n\n**Reason:** \`${reason}\``)
                    .setColor(0xE74C3C);

                return interaction.reply({ embeds: [channelNotice] });
            }
        }

        // --- /ADMIN COMMAND ENGINE ---
        if (interaction.commandName === 'admin') {
            if (callerAdminLevel === 0) {
                const noPerms = new EmbedBuilder().setDescription("You must be a verified bot administrator to use management tools.").setColor(0xE67E22);
                return interaction.reply({ embeds: [noPerms], ephemeral: true });
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'add') {
                const targetLevel = interaction.options.getInteger('level');
                const targetUser = interaction.options.getUser('user');
                const targetRole = interaction.options.getRole('role');

                if (!targetUser && !targetRole) {
                    const err = new EmbedBuilder().setDescription("You must select either a `user` or a `role` parameter to grant clearance.").setColor(0xE67E22);
                    return interaction.reply({ embeds: [err], ephemeral: true });
                }

                if (targetLevel >= callerAdminLevel) {
                    const fail = new EmbedBuilder().setDescription(`Permission Denied. You cannot assign Level ${targetLevel} because your own clearance level is ${callerAdminLevel}.`).setColor(0xE67E22);
                    return interaction.reply({ embeds: [fail], ephemeral: true });
                }

                let responseMessage = "";
                if (targetUser) {
                    serverConfig.adminUsers[targetUser.id] = targetLevel;
                    responseMessage += `Successfully promoted user ${targetUser} to **Level ${targetLevel} Admin**.\n`;
                }
                if (targetRole) {
                    serverConfig.adminRoles[targetRole.id] = targetLevel;
                    responseMessage += `Successfully promoted role ${targetRole} to **Level ${targetLevel} Admin Privilege**.`;
                }

                saveDB();
                const ok = new EmbedBuilder().setTitle("Admin Clearance Assigned").setDescription(responseMessage).setColor(0x3498DB);
                return interaction.reply({ embeds: [ok] });
            }

            if (subcommand === 'delete') {
                const targetUser = interaction.options.getUser('user');
                const targetRole = interaction.options.getRole('role');

                if (!targetUser && !targetRole) {
                    const err = new EmbedBuilder().setDescription("You must specify either a `user` or a `role` object to remove authorization.").setColor(0xE67E22);
                    return interaction.reply({ embeds: [err], ephemeral: true });
                }

                let responseMessage = "";

                if (targetUser) {
                    const targetCurrentLevel = serverConfig.adminUsers[targetUser.id] || 0;
                    if (targetCurrentLevel >= callerAdminLevel) {
                        const fail = new EmbedBuilder().setDescription(`Permission Denied. You cannot remove ${targetUser} because their rank level (${targetCurrentLevel}) matches or exceeds yours (${callerAdminLevel}).`).setColor(0xE67E22);
                        return interaction.reply({ embeds: [fail], ephemeral: true });
                    }
                    delete serverConfig.adminUsers[targetUser.id];
                    responseMessage += `Removed administrator permissions from user ${targetUser}.\n`;
                }

                if (targetRole) {
                    const targetRoleLevel = serverConfig.adminRoles[targetRole.id] || 0;
                    if (targetRoleLevel >= callerAdminLevel) {
                        const fail = new EmbedBuilder().setDescription(`Permission Denied. You cannot strip ${targetRole} because its assigned hierarchy (${targetRoleLevel}) matches or exceeds yours (${callerAdminLevel}).`).setColor(0xE67E22);
                        return interaction.reply({ embeds: [fail], ephemeral: true });
                    }
                    delete serverConfig.adminRoles[targetRole.id];
                    responseMessage += `Removed administrator status configuration from role ${targetRole}.`;
                }

                saveDB();
                const ok = new EmbedBuilder().setTitle("Admin Clearance Revoked").setDescription(responseMessage).setColor(0x3498DB);
                return interaction.reply({ embeds: [ok] });
            }
        }

        // --- /RANKBINDS COMMAND ---
        if (interaction.commandName === 'rankbinds') {
            if (callerAdminLevel === 0) {
                const noPerms = new EmbedBuilder().setDescription("You are missing bot administrator verification to adjust server rank settings.").setColor(0xE67E22);
                return interaction.reply({ embeds: [noPerms], ephemeral: true });
            }

            const groupId = interaction.options.getInteger('groupid');
            const rankId = interaction.options.getInteger('rankid');
            const prefix = interaction.options.getString('prefix');
            const role = interaction.options.getRole('role');

            serverConfig.groupId = groupId; 
            serverConfig.binds[rankId] = { prefix: prefix, roleId: role.id };
            saveDB();

            const embed = new EmbedBuilder()
                .setTitle("Rank Bind Set")
                .setDescription(`Successfully bound Roblox Rank **${rankId}** in Group **${groupId}** to prefix \`${prefix}\` and Discord role ${role}.`)
                .setColor(0x3498DB);

            await interaction.reply({ embeds: [embed] });
            return;
        }

        // --- /UPDATE COMMAND ---
        if (interaction.commandName === 'update') {
            if (!serverConfig || !serverConfig.groupId) {
                const configFailEmbed = new EmbedBuilder()
                    .setDescription("This server hasn't set up group rank bindings yet. Please contact an admin.")
                    .setColor(0xE67E22);
                return interaction.reply({ embeds: [configFailEmbed], ephemeral: true });
            }

            await interaction.deferReply();

            let robloxUser = null;
            if (serverConfig.verifiedUsers && serverConfig.verifiedUsers[member.id]) {
                const storedUserId = serverConfig.verifiedUsers[member.id];
                robloxUser = await getRobloxUserById(storedUserId);
            }

            if (!robloxUser) {
                const currentName = member.nickname || member.user.username;
                const cleanRobloxName = currentName.replace(/^\[[^\]]+\]\s*/, '').trim();
                robloxUser = await getRobloxUser(cleanRobloxName);
            }

            if (!robloxUser) {
                const verifyFailEmbed = new EmbedBuilder()
                    .setDescription("Could not find your verified Roblox account. Please run `!verify` first.")
                    .setColor(0xE67E22);
                return interaction.editReply({ embeds: [verifyFailEmbed] });
            }

            if (!serverConfig.verifiedUsers) serverConfig.verifiedUsers = {};
            serverConfig.verifiedUsers[member.id] = robloxUser.id;
            saveDB();

            const rankValue = await getRobloxUserRank(robloxUser.id, serverConfig.groupId);
            const bindConfig = serverConfig.binds[rankValue];
            let assignedPrefix = "[OR-1]";
            let specificRankRoleId = null;

            if (bindConfig && typeof bindConfig === 'object') {
                assignedPrefix = bindConfig.prefix || "[OR-1]";
                specificRankRoleId = bindConfig.roleId || null;
            }

            const newNickname = `${assignedPrefix} ${robloxUser.username}`;
            if (member.nickname !== newNickname) {
                await member.setNickname(newNickname.substring(0, 32)).catch(() => {});
            }

            let rolesAddedList = [];
            let rolesRemovedList = [];

            const generalVerifiedRole = guild.roles.cache.find(r => r.name === config.VERIFIED_ROLE_NAME);
            if (generalVerifiedRole && !member.roles.cache.has(generalVerifiedRole.id)) {
                await member.roles.add(generalVerifiedRole).catch(() => {});
                rolesAddedList.push(generalVerifiedRole.toString());
            }

            for (const [boundRankId, configObj] of Object.entries(serverConfig.binds)) {
                if (configObj && configObj.roleId && Number(boundRankId) !== rankValue) {
                    if (member.roles.cache.has(configObj.roleId)) {
                        const oldRole = guild.roles.cache.get(configObj.roleId);
                        if (oldRole) {
                            await member.roles.remove(oldRole.id).catch(() => {});
                            rolesRemovedList.push(oldRole.toString());
                        }
                    }
                }
            }

            if (specificRankRoleId) {
                const specificRankRole = guild.roles.cache.get(specificRankRoleId);
                if (specificRankRole && !member.roles.cache.has(specificRankRole.id)) {
                    await member.roles.add(specificRankRole.id).catch(() => {});
                    rolesAddedList.push(specificRankRole.toString());
                }
            }

            await sendVerificationLog(guild, member, robloxUser, "Profile Auto-Scan");

            // Fixed layout strings mirroring exactly (image_b687fc.png)
            const updateEmbed = new EmbedBuilder()
                .setTitle("Roles Update")
                .setDescription("Succesfully updated user roles")
                .addFields(
                    { name: "Nickname", value: `${newNickname}` },
                    { name: "Roles Added", value: rolesAddedList.length > 0 ? rolesAddedList.join(', ') : "None" },
                    { name: "Roles Removed", value: rolesRemovedList.length > 0 ? rolesRemovedList.join(', ') : "None" }
                )
                .setColor(0x2B2D31);

            await interaction.editReply({ embeds: [updateEmbed] });
        }
    }

    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const { customId, user } = interaction;

        if (customId.startsWith('ticket_btn_')) {
            const cooldownKey = `${user.id}-${guild.id}`;
            if (cooldowns.has(cooldownKey)) {
                const remaining = Math.ceil((cooldowns.get(cooldownKey) - Date.now()) / 1000);
                if (remaining > 0) {
                    const cooldownEmbed = new EmbedBuilder()
                        .setTitle('Warning - Cooldown')
                        .setDescription(`You're currently on a **${remaining}s** cooldown for the **Create Ticket** button!`)
                        .setColor(0x2B2D31);
                    return interaction.reply({ embeds: [cooldownEmbed], ephemeral: true });
                }
            }
            cooldowns.set(cooldownKey, Date.now() + 18000);
            setTimeout(() => cooldowns.delete(cooldownKey), 18000);
        }

        if (customId === 'ticket_btn_report') {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('ticket_select_creation')
                .setPlaceholder('Select Ticket Type')
                .addOptions([
                    { label: 'Report High Rank', description: 'Report a high ranking officer.', value: 'rep_hr' },
                    { label: 'Report Exploiter', description: 'Report an exploiter in game to our moderation team', value: 'rep_exploit' },
                    { label: 'Report Corruption', description: 'Report a corrupted user', value: 'rep_corrupt' },
                    { label: 'Report Abuser', description: 'Report an abuser', value: 'rep_abuse' },
                    { label: 'Report Rule Breaker', description: 'Report a rule breaker', value: 'rep_rules' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            return interaction.reply({ content: 'Please select what ticket you wish to create.', components: [row], ephemeral: true });
        }

        if (customId === 'ticket_btn_other') {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('ticket_select_creation')
                .setPlaceholder('Select Ticket Type')
                .addOptions([
                    { label: 'Report Bug / Glitch', description: 'Report an in game / discord glitch or bug to our developers', value: 'oth_bug' },
                    { label: 'Report Exploit Script', description: 'Report an exploit script or vulnerability to our developers', value: 'oth_script' },
                    { label: 'Developer Application', description: 'Apply to become a developer for British Army', value: 'oth_dev' },
                    { label: 'Alliance Application', description: 'Apply to become an ally with the British Army', value: 'oth_alliance' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            return interaction.reply({ content: 'Please select what ticket you wish to create.', components: [row], ephemeral: true });
        }

        if (customId === 'ticket_select_creation') {
            await interaction.deferReply({ ephemeral: true });
            const choice = interaction.values[0];
            
            const parentCategory = serverConfig.ticketCategory ? guild.channels.cache.get(serverConfig.ticketCategory) : null;
            let ticketNum = (serverConfig.ticketCount || 0) + 1;
            serverConfig.ticketCount = ticketNum;
            saveDB();

            const labelMap = {
                'rep_hr': 'high-rank', 'rep_exploit': 'exploiter', 'rep_corrupt': 'corruption', 'rep_abuse': 'abuser', 'rep_rules': 'rule-breaker',
                'oth_bug': 'bug-glitch', 'oth_script': 'exploit-script', 'oth_dev': 'developer-app', 'oth_alliance': 'alliance-app'
            };
            const ticketName = `ticket-${labelMap[choice] || 'general'}-${String(ticketNum).padStart(4, '0')}`;

            const channel = await guild.channels.create({
                name: ticketName,
                type: ChannelType.GuildText,
                parent: parentCategory ? parentCategory.id : null,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
                ]
            });

            const welcomeEmbed = new EmbedBuilder()
                .setTitle('Ticket Opened')
                .setDescription(`Welcome ${user}, our support team will be with you shortly.\nCategory selected: **${ticketName.replace('ticket-', '')}**`)
                .setColor(0xBE1E2D);

            await channel.send({ content: `${user} welcome`, embeds: [welcomeEmbed] });
            return interaction.editReply({ content: `✅ Ticket environment compiled: ${channel}` });
        }
    }
});

// ----------------- MESSAGE HANDLING (!VERIFY) -----------------
client.on('messageCreate', async message => {
    if (message.author.bot || message.content.trim().toLowerCase() !== '!verify') return;

    const guild = message.guild;
    const member = message.member;
    const serverConfig = db[guild.id];

    if (!serverConfig || !serverConfig.groupId) {
        const errEmbed = new EmbedBuilder()
            .setTitle("Setup Required")
            .setDescription("This server has not configured its group verification settings. An administrator needs to run `/rankbinds` first.")
            .setColor(0xE67E22);
        return message.reply({ embeds: [errEmbed] });
    }

    try {
        const verifyChannel = await guild.channels.create({
            name: `verify-${member.user.username.toLowerCase()}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
            ],
        });

        const channelPromptEmbed = new EmbedBuilder()
            .setDescription("Verification channel created. Please check " + verifyChannel + " to verify your account.")
            .setColor(0x3498DB);
        await message.reply({ embeds: [channelPromptEmbed] });

        const step1Embed = new EmbedBuilder()
            .setTitle("Roblox Verification")
            .setDescription(`Hello ${member},\n\nPlease type your **Roblox Username** below to start verification.\n\n*Type \`cancel\` at any time to close this channel.*`)
            .setColor(0x3498DB)
            .setFooter({ text: "Verification System | Step 1 of 3" });
        await verifyChannel.send({ embeds: [step1Embed] });

        const collector = verifyChannel.createMessageCollector({ filter: m => m.author.id === member.id, time: 180000 });
        let step = 'USERNAME';
        let robloxInfo = null;
        let code = '';

        collector.on('collect', async m => {
            const text = m.content.trim();
            if (text.toLowerCase() === 'cancel') {
                const cancelEmbed = new EmbedBuilder()
                    .setTitle("Canceled")
                    .setDescription("Verification process canceled. Closing channel...")
                    .setColor(0xE67E22);
                await verifyChannel.send({ embeds: [cancelEmbed] });
                collector.stop('canceled'); 
                return; 
            }

            if (step === 'USERNAME') {
                const searchEmbed = new EmbedBuilder()
                    .setDescription(`Searching for \`${text}\` on Roblox...`)
                    .setColor(0x3498DB);
                const searchMsg = await verifyChannel.send({ embeds: [searchEmbed] });

                robloxInfo = await getRobloxUser(text);
                await searchMsg.delete().catch(() => {});

                if (!robloxInfo) {
                    const failSearchEmbed = new EmbedBuilder()
                        .setTitle("Account Not Found")
                        .setDescription("Could not find that Roblox account. Make sure you typed your exact **Username**, not your Display Name.\n\nClosing channel...")
                        .setColor(0xE67E22);
                    await verifyChannel.send({ embeds: [failSearchEmbed] });
                    collector.stop('failed');
                    return;
                }

                step = 'CONFIRM';
                const confirmEmbed = new EmbedBuilder()
                    .setTitle("Is this your account?")
                    .setDescription("Please confirm if this is your account. Reply with **`YES`** or **`NO`**.")
                    .addFields(
                        { name: "Username", value: `\`${robloxInfo.username}\``, inline: true },
                        { name: "User ID", value: `\`${robloxInfo.id}\``, inline: true },
                        { name: "Profile Link", value: `[View Profile](https://www.roblox.com/users/${robloxInfo.id}/profile)` }
                    )
                    .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${robloxInfo.id}&width=150&height=150&format=png`)
                    .setColor(0x3498DB)
                    .setFooter({ text: "Verification System | Step 2 of 3" });
                verifyChannel.send({ embeds: [confirmEmbed] });
                return;
            }

            if (step === 'CONFIRM') {
                if (text.toUpperCase() !== 'YES') {
                    const stopEmbed = new EmbedBuilder()
                        .setTitle("Aborted")
                        .setDescription("Verification stopped by user. Closing channel...")
                        .setColor(0xE67E22);
                    await verifyChannel.send({ embeds: [stopEmbed] });
                    collector.stop('canceled'); 
                    return; 
                }

                code = generateVerificationCode();
                step = 'DONE';

                const instructionsEmbed = new EmbedBuilder()
                    .setTitle("Profile Verification")
                    .setDescription(`To verify you own this account, please copy the code below and paste it into your Roblox profile's **About** or **Description** section.`)
                    .addFields({ name: "Code to Copy", value: `\`\`\`${code}\`\`\`` })
                    .setColor(0x3498DB)
                    .setFooter({ text: "Once you have saved your Roblox profile, type 'DONE' here." });
                await verifyChannel.send({ embeds: [instructionsEmbed] });
                return;
            }

            if (step === 'DONE' && text.toUpperCase() === 'DONE') {
                const checkingEmbed = new EmbedBuilder()
                    .setDescription("Checking your Roblox profile status...")
                    .setColor(0x3498DB);
                const statusCheckingMsg = await verifyChannel.send({ embeds: [checkingEmbed] });

                const freshProfile = await getRobloxUser(robloxInfo.username);
                await statusCheckingMsg.delete().catch(() => {});

                if (freshProfile && freshProfile.description.includes(code)) {
                    if (!serverConfig.verifiedUsers) serverConfig.verifiedUsers = {};
                    serverConfig.verifiedUsers[member.id] = freshProfile.id;
                    saveDB();

                    const rankValue = await getRobloxUserRank(freshProfile.id, serverConfig.groupId);
                    const bindConfig = serverConfig.binds[rankValue];
                    let assignedPrefix = "[OR-1]";
                    let specificRankRoleId = null;

                    if (bindConfig && typeof bindConfig === 'object') {
                        assignedPrefix = bindConfig.prefix || "[OR-1]";
                        specificRankRoleId = bindConfig.roleId || null;
                    }

                    const baseVerifiedRole = guild.roles.cache.find(r => r.name === config.VERIFIED_ROLE_NAME);
                    if (baseVerifiedRole) await member.roles.add(baseVerifiedRole).catch(() => {});

                    if (specificRankRoleId) {
                        const targetRankRole = guild.roles.cache.get(specificRankRoleId);
                        if (targetRankRole) await member.roles.add(targetRankRole.id).catch(() => {});
                    }

                    const newNickname = `${assignedPrefix} ${freshProfile.username}`;
                    await member.setNickname(newNickname.substring(0, 32)).catch(() => {});

                    await sendVerificationLog(guild, member, freshProfile, "Code Verification");

                    const successEmbed = new EmbedBuilder()
                        .setTitle("Verification Successful")
                        .setDescription(`You have been verified as **${freshProfile.username}**.\n\n• **Prefix:** \`${assignedPrefix}\`\n• **Nickname:** \`${newNickname}\``)
                        .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${freshProfile.id}&width=150&height=150&format=png`)
                        .setColor(0x3498DB)
                        .setFooter({ text: "Success! Deleting this channel in 5 seconds..." });
                    await verifyChannel.send({ embeds: [successEmbed] });
                    collector.stop('success');
                } else {
                    const codeMissingEmbed = new EmbedBuilder()
                        .setTitle("Verification Failed")
                        .setDescription(`The verification code was not found on your profile description.\n\n**Expected Code:** \`${code}\`\n\nMake sure you saved the changes on Roblox, and type **\`DONE\`** here to try again.`)
                        .setColor(0xE67E22);
                    await verifyChannel.send({ embeds: [codeMissingEmbed] });
                }
            }
        });

        collector.on('end', () => {
            setTimeout(() => {
                verifyChannel.delete().catch(() => {});
            }, 5000);
        });

    } catch (channelError) {
        console.error("Verification system error:", channelError);
    }
});

async function launchEngine() {
    try {
        console.log('Registering slash commands...');
        await rest.put(Routes.applicationCommands(config.CLIENT_ID), { body: commands });
        console.log('Successfully registered commands globally.');
        await client.login(config.TOKEN);
    } catch (initError) {
        console.error('Bot login failed:', initError);
    }
}

require('./server.js');

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

launchEngine();