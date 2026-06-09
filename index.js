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
    PermissionsBitField
} = require('discord.js');
const { request } = require('undici');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const VERIFIED_ROLE_NAME = process.env.VERIFIED_ROLE_NAME;

const DB_FILE = './database.json';
const WORD_POOL = ["pizza", "right", "verification", "army", "left", "blue", "robot", "down", "cheese", "yes", "up", "green", "tiger"];
const cooldowns = new Map();

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

function formatDurationString(str) {
    if (!str) return "Permanent";
    const match = str.match(/^(\d+)([mhwd])$/i);
    if (!match) return str;
    const value = match[1];
    const unit = match[2].toLowerCase();
    const unitNames = { m: 'minute', h: 'hour', d: 'day', w: 'week' };
    return `${value} ${unitNames[unit]}${parseInt(value, 10) !== 1 ? 's' : ''}`;
}

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
        .setColor(0x3498DB)
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
        .setDescription('Manage Roblox rank bindings for this server')
        .addSubcommand(sub =>
            sub.setName('add')
               .setDescription('Bind a Roblox Rank to a Discord Prefix and Role')
               .addIntegerOption(option => option.setName('groupid').setDescription('Roblox Group ID').setRequired(true))
               .addIntegerOption(option => option.setName('rankid').setDescription('Roblox Rank ID (1-255)').setRequired(true))
               .addStringOption(option => option.setName('prefix').setDescription('Prefix to apply (e.g. [OR-1])').setRequired(true))
               .addRoleOption(option => option.setName('role').setDescription('Discord role for this rank').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('delete')
               .setDescription('Remove an existing Roblox rank binding')
               .addIntegerOption(option => option.setName('rankid').setDescription('The Roblox Rank ID you want to unbind').setRequired(true))
        ),
            
    new SlashCommandBuilder()
        .setName('update')
        .setDescription('Sync your nickname and roles with your Roblox rank'),

    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Manage bot admins and clearance levels')
        .addSubcommand(sub => 
            sub.setName('add')
               .setDescription('Add a user or role as a bot admin')
               .addIntegerOption(opt => opt.setName('level').setDescription('Clearance level (1-7)').setRequired(true).setMinValue(1).setMaxValue(7))
               .addUserOption(opt => opt.setName('user').setDescription('User to add').setRequired(false))
               .addRoleOption(opt => opt.setName('role').setDescription('Role to add').setRequired(false)))
        .addSubcommand(sub => 
            sub.setName('delete')
               .setDescription('Remove admin permissions from a user or role')
               .addUserOption(opt => opt.setName('user').setDescription('User to remove').setRequired(false))
               .addRoleOption(opt => opt.setName('role').setDescription('Role to remove').setRequired(false))),

    new SlashCommandBuilder()
        .setName('verification-logs')
        .setDescription('Set up the log channel for verifications')
        .addChannelOption(opt => 
            opt.setName('channel')
               .setDescription('Select the text channel for logs')
               .setRequired(true)
               .addChannelTypes(ChannelType.GuildText)),

    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Log a formal warning for a user')
        .addUserOption(opt => opt.setName('user').setDescription('User to warn').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the warning').setRequired(true)),

    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout/Mute a member in the server')
        .addUserOption(opt => opt.setName('user').setDescription('User to mute').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('How long (e.g. 30m, 3h, 1d)').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the mute').setRequired(true)),

    new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove a timeout/mute from a member')
        .addUserOption(opt => opt.setName('user').setDescription('User to unmute').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the unmute').setRequired(false)),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Permanently ban a member from the server')
        .addUserOption(opt => opt.setName('user').setDescription('User to ban').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the ban').setRequired(true)),

    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user from the server using their user ID')
        .addStringOption(opt => opt.setName('userid').setDescription('The Discord User ID to unban').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the unban').setRequired(false)),

    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Manage the ticket system environment')
        .addSubcommand(sub =>
            sub.setName('configure')
               .setDescription('Set the category where new tickets are created')
               .addChannelOption(opt => opt.setName('category').setDescription('The target category channel').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('add')
               .setDescription('Add a user to the current ticket channel')
               .addUserOption(opt => opt.setName('target').setDescription('The user to add').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('panel')
               .setDescription('Send an interactive ticket portal panel')
               .addStringOption(opt => 
                    opt.setName('type')
                       .setDescription('Select the ticket panel style')
                       .setRequired(true)
                       .addChoices(
                           { name: 'Report Tickets Panel', value: 'report' },
                           { name: 'Other Tickets Panel', value: 'other' }
                       ))
        ),

    new SlashCommandBuilder()
        .setName('roblox-cookie')
        .setDescription('Configure group verification cookie settings (Requires Level 5 Admin)')
        .addStringOption(opt => opt.setName('cookie').setDescription('Your .ROBLOX_SECURITY cookie token').setRequired(true))
        .addStringOption(opt => opt.setName('groupid').setDescription('Your Roblox Group ID').setRequired(true)),

    new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Promote a user inside the bound Roblox group')
        .addStringOption(opt => opt.setName('username').setDescription('Their Roblox account username').setRequired(true)),

    new SlashCommandBuilder()
        .setName('demote')
        .setDescription('Demote a user inside the bound Roblox group')
        .addStringOption(opt => opt.setName('username').setDescription('Their Roblox account username').setRequired(true)),

    new SlashCommandBuilder()
        .setName('set-rank')
        .setDescription('Directly set a user to a specific Roblox rank ID')
        .addStringOption(opt => opt.setName('username').setDescription('Their Roblox account username').setRequired(true))
        .addIntegerOption(opt => opt.setName('rankid').setDescription('The target Rank ID integer (1-255)').setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

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

// ----------------- INTERACTION HANDLING -----------------
client.on('interactionCreate', async interaction => {
    const guild = interaction.guild;
    const member = interaction.member;

    if (!guild) return;

    if (!db.globalVerifiedUsers) {
        db.globalVerifiedUsers = {};
    }

    if (!db[guild.id]) {
        db[guild.id] = { groupId: null, binds: {}, adminUsers: {}, adminRoles: {}, ticketCategory: null, ticketCount: 0, robloxCookie: null };
    }
    if (!db[guild.id].binds) db[guild.id].binds = {};
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
                    const embed = new EmbedBuilder().setDescription("You don't have permission to change the ticket category.").setColor(0xE67E22);
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
                const category = interaction.options.getChannel('category');
                serverConfig.ticketCategory = category.id;
                saveDB();
                const embed = new EmbedBuilder().setDescription(`Ticket category successfully set to: **${category.name}**`).setColor(0x3498DB);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (subcommand === 'add') {
                if (!interaction.channel.name.startsWith('ticket-')) {
                    const embed = new EmbedBuilder().setDescription("This command can only be used inside an active ticket channel.").setColor(0xE67E22);
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
                const target = interaction.options.getUser('target');
                await interaction.channel.permissionOverwrites.edit(target.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
                const embed = new EmbedBuilder().setDescription(`Added **${target.username}** to this ticket channel.`).setColor(0x3498DB);
                return interaction.reply({ embeds: [embed] });
            }

            if (subcommand === 'panel') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && callerAdminLevel === 0) {
                    const embed = new EmbedBuilder().setDescription("You don't have permission to place ticket panels.").setColor(0xE67E22);
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
                const type = interaction.options.getString('type');

                if (type === 'report') {
                    const embed = new EmbedBuilder()
                        .setTitle('REPORT TICKETS')
                        .setDescription('Click the 🚨 **Create Ticket** button below to report an incident or user.')
                        .setColor(0x3498DB);

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('ticket_btn_report').setLabel('Create Ticket').setStyle(ButtonStyle.Danger)
                    );
                    await interaction.channel.send({ embeds: [embed], components: [row] });
                } else if (type === 'other') {
                    const embed = new EmbedBuilder()
                        .setTitle('OTHER TICKETS')
                        .setDescription('Click the 🚨 **Create Ticket** button below to open a ticket for other matters.')
                        .setColor(0x3498DB);

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('ticket_btn_other').setLabel('Create Ticket').setStyle(ButtonStyle.Danger)
                    );
                    await interaction.channel.send({ embeds: [embed], components: [row] });
                }

                const successEmbed = new EmbedBuilder().setDescription("Ticket panel posted successfully.").setColor(0x3498DB);
                return interaction.reply({ embeds: [successEmbed], ephemeral: true });
            }
        }

        // --- /VERIFICATION-LOGS CONFIGURATION COMMAND ---
        if (interaction.commandName === 'verification-logs') {
            if (callerAdminLevel === 0) {
                const embed = new EmbedBuilder().setDescription("You need to be a bot administrator to change log settings.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            const logChannel = interaction.options.getChannel('channel');
            serverConfig.logChannelId = logChannel.id;
            saveDB();

            const embed = new EmbedBuilder().setDescription(`Logs will now be sent to ${logChannel}.`).setColor(0x3498DB);
            return interaction.reply({ embeds: [embed] });
        }

        // --- MODERATION ACTIONS ENGINE (/WARN, /MUTE, /UNMUTE, /BAN, /UNBAN) ---
        if (['warn', 'mute', 'unmute', 'ban'].includes(interaction.commandName)) {
            if (callerAdminLevel === 0) {
                const embed = new EmbedBuilder().setDescription("You must be an authorized bot admin to use moderation actions.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            const targetUser = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || "No reason specified.";
            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

            if (!targetMember) {
                const embed = new EmbedBuilder().setDescription("That user isn't in this server.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            const targetAdminLevel = getAdminLevel(guild, targetMember);
            if (targetAdminLevel >= callerAdminLevel) {
                const embed = new EmbedBuilder().setDescription(`Action denied. You cannot moderate ${targetUser} because their admin level (${targetAdminLevel}) is equal to or higher than yours (${callerAdminLevel}).`).setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (interaction.commandName === 'warn') {
                const dmEmbed = new EmbedBuilder().setTitle("Warning Notice").setDescription(`You have been warned in **${guild.name}**.\n**Reason:** ${reason}`).setColor(0xE67E22);
                await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

                const embed = new EmbedBuilder().setDescription(`**${targetUser.tag}** has been warned.\n**Reason:** ${reason}`).setColor(0x3498DB);
                return interaction.reply({ embeds: [embed] });
            }

            if (interaction.commandName === 'mute') {
                const rawDuration = interaction.options.getString('duration');
                const durationMs = parseDuration(rawDuration);

                if (!durationMs) {
                    const embed = new EmbedBuilder().setDescription("Invalid time format. Please use something like `30m`, `3h`, or `1d`.").setColor(0xE67E22);
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                const cleanDurationStr = formatDurationString(rawDuration);
                await targetMember.timeout(durationMs, reason).catch(err => {
                    console.error(err);
                });

                const dmEmbed = new EmbedBuilder().setTitle("Mute Notice").setDescription(`You have been muted in **${guild.name}** for ${cleanDurationStr}.\n**Reason:** ${reason}`).setColor(0xE67E22);
                await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

                const embed = new EmbedBuilder().setDescription(`**${targetUser.tag}** has been muted for ${cleanDurationStr}.\n**Reason:** ${reason}`).setColor(0x3498DB);
                return interaction.reply({ embeds: [embed] });
            }

            if (interaction.commandName === 'unmute') {
                if (!targetMember.communicationDisabledUntilTimestamp) {
                    const embed = new EmbedBuilder().setDescription(`**${targetUser.tag}** is not currently muted.`).setColor(0xE67E22);
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                await targetMember.timeout(null, reason).catch(err => {
                    console.error(err);
                });

                const dmEmbed = new EmbedBuilder().setTitle("Unmute Notice").setDescription(`Your mute has been removed in **${guild.name}**.\n**Reason:** ${reason}`).setColor(0x3498DB);
                await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

                const embed = new EmbedBuilder().setDescription(`Successfully unmuted **${targetUser.tag}**.\n**Reason:** ${reason}`).setColor(0x3498DB);
                return interaction.reply({ embeds: [embed] });
            }

            if (interaction.commandName === 'ban') {
                const dmEmbed = new EmbedBuilder().setTitle("Ban Notice").setDescription(`You have been permanently banned from **${guild.name}**.\n**Reason:** ${reason}`).setColor(0xE67E22);
                await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});
                
                await targetMember.ban({ reason: reason }).catch(err => {
                    console.error(err);
                });

                const embed = new EmbedBuilder().setDescription(`**${targetUser.tag}** has been permanently banned.\n**Reason:** ${reason}`).setColor(0x3498DB);
                return interaction.reply({ embeds: [embed] });
            }
        }

        // --- /UNBAN COMMAND HANDLING ---
        if (interaction.commandName === 'unban') {
            if (callerAdminLevel === 0) {
                const embed = new EmbedBuilder().setDescription("You must be an authorized bot admin to use moderation actions.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            const targetUserId = interaction.options.getString('userid');
            const reason = interaction.options.getString('reason') || "No reason specified.";

            const banList = await guild.bans.fetch().catch(() => null);
            if (!banList || !banList.has(targetUserId)) {
                const embed = new EmbedBuilder().setDescription("That user ID could not be found on the server ban list.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            await guild.members.unban(targetUserId, reason).catch(err => {
                console.error(err);
            });

            const embed = new EmbedBuilder().setDescription(`Successfully unbanned user ID \`${targetUserId}\` from the server.\n**Reason:** ${reason}`).setColor(0x3498DB);
            return interaction.reply({ embeds: [embed] });
        }

        // --- /ADMIN COMMAND ENGINE ---
        if (interaction.commandName === 'admin') {
            if (callerAdminLevel === 0) {
                const embed = new EmbedBuilder().setDescription("You must be a bot administrator to use admin settings.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'add') {
                const targetLevel = interaction.options.getInteger('level');
                const targetUser = interaction.options.getUser('user');
                const targetRole = interaction.options.getRole('role');

                if (!targetUser && !targetRole) {
                    const embed = new EmbedBuilder().setDescription("Please specify either a user or a role to grant clearance.").setColor(0xE67E22);
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                if (targetLevel >= callerAdminLevel) {
                    const embed = new EmbedBuilder().setDescription(`Action denied. You cannot grant Level ${targetLevel} because your own admin level is ${callerAdminLevel}.`).setColor(0xE67E22);
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                let msg = "";
                if (targetUser) {
                    serverConfig.adminUsers[targetUser.id] = targetLevel;
                    msg += `Added ${targetUser} as a **Level ${targetLevel} Admin**.\n`;
                }
                if (targetRole) {
                    serverConfig.adminRoles[targetRole.id] = targetLevel;
                    msg += `Added role ${targetRole} to **Level ${targetLevel} Admin Privileges**.`;
                }

                saveDB();
                const embed = new EmbedBuilder().setDescription(msg).setColor(0x3498DB);
                return interaction.reply({ embeds: [embed] });
            }

            if (subcommand === 'delete') {
                const targetUser = interaction.options.getUser('user');
                const targetRole = interaction.options.getRole('role');

                if (!targetUser && !targetRole) {
                    const embed = new EmbedBuilder().setDescription("Please choose either a user or a role to remove admin from.").setColor(0xE67E22);
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                let msg = "";

                if (targetUser) {
                    const currentLevel = serverConfig.adminUsers[targetUser.id] || 0;
                    if (currentLevel >= callerAdminLevel) {
                        const embed = new EmbedBuilder().setDescription(`Action denied. You cannot remove ${targetUser} because their level matches or exceeds yours.`).setColor(0xE67E22);
                        return interaction.reply({ embeds: [embed], ephemeral: true });
                    }
                    delete serverConfig.adminUsers[targetUser.id];
                    msg += `Removed admin options from ${targetUser}.\n`;
                }

                if (targetRole) {
                    const roleLevel = serverConfig.adminRoles[targetRole.id] || 0;
                    if (roleLevel >= callerAdminLevel) {
                        const embed = new EmbedBuilder().setDescription(`Action denied. You cannot remove ${targetRole} because its assigned clearance level matches or exceeds yours.`).setColor(0xE67E22);
                        return interaction.reply({ embeds: [embed], ephemeral: true });
                    }
                    delete serverConfig.adminRoles[targetRole.id];
                    msg += `Removed admin options from role ${targetRole}.`;
                }

                saveDB();
                const embed = new EmbedBuilder().setDescription(msg).setColor(0x3498DB);
                return interaction.reply({ embeds: [embed] });
            }
        }

        // --- /RANKBINDS COMMAND ---
        if (interaction.commandName === 'rankbinds') {
            if (callerAdminLevel === 0) {
                const embed = new EmbedBuilder().setDescription("You must be an authorized bot admin to adjust rank configurations.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'add') {
                const groupId = interaction.options.getInteger('groupid');
                const rankId = interaction.options.getInteger('rankid');
                const prefix = interaction.options.getString('prefix');
                const role = interaction.options.getRole('role');

                serverConfig.groupId = groupId; 
                serverConfig.binds[rankId] = { prefix: prefix, roleId: role.id };
                saveDB();

                const embed = new EmbedBuilder().setDescription(`Successfully bound Roblox Rank **${rankId}** in Group **${groupId}** to prefix \`${prefix}\` and Discord role ${role}.`).setColor(0x3498DB);
                return interaction.reply({ embeds: [embed] });
            }

            if (subcommand === 'delete') {
                const rankId = interaction.options.getInteger('rankid');

                if (!serverConfig.binds || !serverConfig.binds[rankId]) {
                    const embed = new EmbedBuilder().setDescription(`There is no active rank bind configured for Roblox Rank ID **${rankId}** in this server.`).setColor(0xE67E22);
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                delete serverConfig.binds[rankId];
                saveDB();

                const embed = new EmbedBuilder().setDescription(`Successfully removed the binding configuration for Roblox Rank ID **${rankId}**.`).setColor(0x3498DB);
                return interaction.reply({ embeds: [embed] });
            }
        }

        // --- /UPDATE COMMAND ---
        if (interaction.commandName === 'update') {
            if (!serverConfig || !serverConfig.groupId) {
                const embed = new EmbedBuilder().setDescription("This server has not configured any group rank binds yet.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            await interaction.deferReply();

            let robloxUser = null;
            
            if (db.globalVerifiedUsers && db.globalVerifiedUsers[member.id]) {
                const storedUserId = db.globalVerifiedUsers[member.id];
                robloxUser = await getRobloxUserById(storedUserId);
            }

            if (!robloxUser) {
                const currentName = member.nickname || member.user.username;
                const cleanName = currentName.replace(/^\[[^\]]+\]\s*/, '').trim();
                robloxUser = await getRobloxUser(cleanName);
            }

            if (!robloxUser) {
                const embed = new EmbedBuilder().setDescription("Could not find your linked Roblox profile. Please make sure your Discord nickname or username matches your Roblox account, then try again.").setColor(0xE67E22);
                return interaction.editReply({ embeds: [embed] });
            }

            db.globalVerifiedUsers[member.id] = robloxUser.id;
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

            const generalVerifiedRole = guild.roles.cache.find(r => r.name === VERIFIED_ROLE_NAME);
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
                const targetRoleObj = guild.roles.cache.get(specificRankRoleId);
                if (targetRoleObj && !member.roles.cache.has(targetRoleObj.id)) {
                    await member.roles.add(targetRoleObj.id).catch(() => {});
                    rolesAddedList.push(targetRoleObj.toString());
                }
            }

            const embed = new EmbedBuilder()
                .setTitle("Profile Settings Synchronized")
                .setDescription(`Successfully verified data tables for **${robloxUser.username}**.`)
                .addFields(
                    { name: "Prefix Applied", value: `\`${assignedPrefix}\``, inline: true },
                    { name: "Group Rank ID", value: `\`${rankValue}\``, inline: true },
                    { name: "Granted Roles", value: rolesAddedList.length > 0 ? rolesAddedList.join(', ') : "None", inline: false },
                    { name: "Removed Roles", value: rolesRemovedList.length > 0 ? rolesRemovedList.join(', ') : "None", inline: false }
                )
                .setColor(0x3498DB);

            return interaction.editReply({ embeds: [embed] });
        }

        // --- /ROBLOX-COOKIE COMMAND ---
        if (interaction.commandName === 'roblox-cookie') {
            if (callerAdminLevel < 5) {
                const embed = new EmbedBuilder().setDescription("Access Denied. You must be at least a Level 5 Admin to run this.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            const inputCookie = interaction.options.getString('cookie');
            const targetGroup = interaction.options.getString('groupid');

            try {
                const userLookup = await request('https://users.roblox.com/v1/users/authenticated', {
                    method: 'GET',
                    headers: { 'Cookie': `.ROBLOX_SECURITY=${inputCookie}` }
                });

                if (userLookup.statusCode !== 200) {
                    const embed = new EmbedBuilder().setDescription("Roblox API rejected the provided cookie token.").setColor(0xE67E22);
                    return interaction.editReply({ embeds: [embed] });
                }

                const userData = await userLookup.body.json();
                serverConfig.robloxCookie = inputCookie;
                serverConfig.groupId = Number(targetGroup);
                saveDB();

                const embed = new EmbedBuilder().setDescription(`Successfully logged in as **${userData.name}** (\`${userData.id}\`). Linked to Group: \`${targetGroup}\`.`).setColor(0x3498DB);
                return interaction.editReply({ embeds: [embed] });
            } catch (err) {
                console.error(err);
                const embed = new EmbedBuilder().setDescription("Could not connect to Roblox authentication endpoints.").setColor(0xE67E22);
                return interaction.editReply({ embeds: [embed] });
            }
        }

        // --- /PROMOTE COMMAND ---
        if (interaction.commandName === 'promote') {
            if (callerAdminLevel < 5) {
                const embed = new EmbedBuilder().setDescription("Access Denied. You must be at least a Level 5 Admin to rank users.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            if (!serverConfig.robloxCookie || !serverConfig.groupId) {
                const embed = new EmbedBuilder().setDescription("Missing authentication values. Please set `/roblox-cookie` first.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            await interaction.deferReply();
            const username = interaction.options.getString('username');
            const profile = await getRobloxUser(username);

            if (!profile) {
                const embed = new EmbedBuilder().setDescription(`Could not find a Roblox account named \`${username}\`.`).setColor(0xE67E22);
                return interaction.editReply({ embeds: [embed] });
            }

            try {
                const token = await fetchRobloxTokenSignature(serverConfig.robloxCookie);
                const res = await request(`https://groups.roblox.com/v1/groups/${serverConfig.groupId}/users/${profile.id}/promote`, {
                    method: 'POST',
                    headers: { 'Cookie': `.ROBLOX_SECURITY=${serverConfig.robloxCookie}`, 'X-CSRF-TOKEN': token || '' }
                });

                const data = await res.body.json();
                if (res.statusCode !== 200) {
                    const embed = new EmbedBuilder().setDescription(`Promotion failed: ${data.errors ? data.errors[0].message : 'Unknown ranking error.'}`).setColor(0xE67E22);
                    return interaction.editReply({ embeds: [embed] });
                }

                const embed = new EmbedBuilder().setDescription(`⚡ **${profile.username}** has been promoted to **${data.newRole.name}** (\`Rank ${data.newRole.rank}\`).`).setColor(0x3498DB);
                return interaction.editReply({ embeds: [embed] });
            } catch (e) {
                const embed = new EmbedBuilder().setDescription("Network failure while updating rank settings on Roblox.").setColor(0xE67E22);
                return interaction.editReply({ embeds: [embed] });
            }
        }

        // --- /DEMOTE COMMAND ---
        if (interaction.commandName === 'demote') {
            if (callerAdminLevel < 5) {
                const embed = new EmbedBuilder().setDescription("Access Denied. You must be at least a Level 5 Admin to rank users.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            if (!serverConfig.robloxCookie || !serverConfig.groupId) {
                const embed = new EmbedBuilder().setDescription("Missing authentication values. Please set `/roblox-cookie` first.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            await interaction.deferReply();
            const username = interaction.options.getString('username');
            const profile = await getRobloxUser(username);

            if (!profile) {
                const embed = new EmbedBuilder().setDescription(`Could not find a Roblox account named \`${username}\`.`).setColor(0xE67E22);
                return interaction.editReply({ embeds: [embed] });
            }

            try {
                const token = await fetchRobloxTokenSignature(serverConfig.robloxCookie);
                const res = await request(`https://groups.roblox.com/v1/groups/${serverConfig.groupId}/users/${profile.id}/demote`, {
                    method: 'POST',
                    headers: { 'Cookie': `.ROBLOX_SECURITY=${serverConfig.robloxCookie}`, 'X-CSRF-TOKEN': token || '' }
                });

                const data = await res.body.json();
                if (res.statusCode !== 200) {
                    const embed = new EmbedBuilder().setDescription(`Demotion failed: ${data.errors ? data.errors[0].message : 'Unknown ranking error.'}`).setColor(0xE67E22);
                    return interaction.editReply({ embeds: [embed] });
                }

                const embed = new EmbedBuilder().setDescription(`🔻 **${profile.username}** has been demoted to **${data.newRole.name}** (\`Rank ${data.newRole.rank}\`).`).setColor(0x3498DB);
                return interaction.editReply({ embeds: [embed] });
            } catch (e) {
                const embed = new EmbedBuilder().setDescription("Network failure while updating rank settings on Roblox.").setColor(0xE67E22);
                return interaction.editReply({ embeds: [embed] });
            }
        }

        // --- /SET-RANK COMMAND ---
        if (interaction.commandName === 'set-rank') {
            if (callerAdminLevel < 5) {
                const embed = new EmbedBuilder().setDescription("Access Denied. You must be at least a Level 5 Admin to directly change ranks.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            if (!serverConfig.robloxCookie || !serverConfig.groupId) {
                const embed = new EmbedBuilder().setDescription("Missing authentication values. Please set `/roblox-cookie` first.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            await interaction.deferReply();
            const username = interaction.options.getString('username');
            const targetRankId = interaction.options.getInteger('rankid');

            const profile = await getRobloxUser(username);
            if (!profile) {
                const embed = new EmbedBuilder().setDescription(`Could not find a Roblox account named \`${username}\`.`).setColor(0xE67E22);
                return interaction.editReply({ embeds: [embed] });
            }

            const rolesList = await fetchRobloxRoleSets(serverConfig.groupId);
            const targetedRoleMatch = rolesList.find(r => r.rank === targetRankId);

            if (!targetedRoleMatch) {
                const embed = new EmbedBuilder().setDescription(`The rank value \`${targetRankId}\` does not exist inside your bound Roblox Group.`).setColor(0xE67E22);
                return interaction.editReply({ embeds: [embed] });
            }

            try {
                const token = await fetchRobloxTokenSignature(serverConfig.robloxCookie);
                
                const res = await request(`https://groups.roblox.com/v1/groups/${serverConfig.groupId}/users/${profile.id}`, {
                    method: 'PATCH',
                    headers: { 
                        'Cookie': `.ROBLOX_SECURITY=${serverConfig.robloxCookie}`, 
                        'X-CSRF-TOKEN': token || '',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ roleId: targetedRoleMatch.id })
                });

                if (res.statusCode !== 200) {
                    const data = await res.body.json();
                    const embed = new EmbedBuilder().setDescription(`Ranking failed: ${data.errors ? data.errors[0].message : 'Unknown API failure.'}`).setColor(0xE67E22);
                    return interaction.editReply({ embeds: [embed] });
                }

                const embed = new EmbedBuilder().setDescription(`⚙️ **${profile.username}** has been directly set to rank **${targetedRoleMatch.name}** (\`Rank ${targetedRoleMatch.rank}\`).`).setColor(0x3498DB);
                return interaction.editReply({ embeds: [embed] });
            } catch (err) {
                const embed = new EmbedBuilder().setDescription("Network failure while contacting Roblox group engines.").setColor(0xE67E22);
                return interaction.editReply({ embeds: [embed] });
            }
        }
    }

    // --- BUTTON COMPONENT INTERACTION LOGIC ---
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('ticket_btn_')) {
            const ticketType = interaction.customId.replace('ticket_btn_', '');
            const userId = interaction.user.id;

            if (!serverConfig.ticketCategory) {
                const embed = new EmbedBuilder().setDescription("Tickets cannot be opened because an administrator has not configured a category workspace yet.").setColor(0xE67E22);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (cooldowns.has(userId)) {
                const remaining = Math.ceil((cooldowns.get(userId) - Date.now()) / 1000);
                if (remaining > 0) {
                    const embed = new EmbedBuilder().setDescription(`Please wait **${remaining}s** before opening another support ticket channel.`).setColor(0xE67E22);
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
            }

            cooldowns.set(userId, Date.now() + 18000);
            setTimeout(() => cooldowns.delete(userId), 18000);

            await interaction.deferReply({ ephemeral: true });

            if (!serverConfig.ticketCount) serverConfig.ticketCount = 0;
            serverConfig.ticketCount++;
            saveDB();

            const paddedCount = String(serverConfig.ticketCount).padStart(4, '0');
            const channelName = `ticket-${ticketType}-${paddedCount}`;

            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: serverConfig.ticketCategory,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
                ]
            });

            const welcomeEmbed = new EmbedBuilder()
                .setTitle(`${ticketType.toUpperCase()} TICKET CREATED`)
                .setDescription(`Welcome ${interaction.user}. Support details will report here to assist you shortly.\nTo invite others, utilize \`/ticket add\`.`)
                .setColor(0x3498DB)
                .setTimestamp();

            await ticketChannel.send({ content: `${interaction.user}`, embeds: [welcomeEmbed] });

            const finishEmbed = new EmbedBuilder().setDescription(`Your ticket channel has been opened inside ${ticketChannel}`).setColor(0x3498DB);
            return interaction.editReply({ embeds: [finishEmbed] });
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

                    const baseVerifiedRole = guild.roles.cache.find(r => r.name === VERIFIED_ROLE_NAME);
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
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('Successfully registered commands globally.');
        await client.login(TOKEN);
    } catch (initError) {
        console.error('Bot login failed:', initError);
    }
}

require('./server.js');

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

launchEngine();
