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

if (!TOKEN) {
    console.error("Error: Bot token missing.");
    process.exit(1);
}

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
    try { fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 2), 'utf8'); } catch (e) {}
} else {
    try {
        const content = fs.readFileSync(DB_FILE, 'utf8').trim();
        db = content ? JSON.parse(content) : {};
    } catch { db = {}; }
}

function saveDB() {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) {}
}

const activeSessions = new Map();
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
                highestLevel = Math.max(highestLevel, level);
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

// ==========================================
// ROBLOX INTEGRATION CORES
// ==========================================
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
            return { id: user.id, username: user.requestedUsername || user.name, description: pData.description || "" };
        }
    } catch (e) {}
    return null;
}

async function getRobloxUserById(userId) {
    try {
        const res = await request(`https://users.roblox.com/v1/users/${userId}`);
        const data = await res.body.json();
        if (data && data.id) {
            return { id: data.id, username: data.name, description: data.description || "" };
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

async function changeRobloxRank(guildId, robloxUserId, targetRankValue) {
    const serverConfig = db[guildId];
    if (!serverConfig || !serverConfig.robloxCookie || !serverConfig.groupId) {
        throw new Error("Roblox cookie or Group ID missing in config.");
    }

    const rolesRes = await request(`https://groups.roblox.com/v1/groups/${serverConfig.groupId}/roles`);
    const rolesData = await rolesRes.body.json();
    const targetRole = rolesData.roles.find(r => r.rank === parseInt(targetRankValue, 10));
    
    if (!targetRole) throw new Error(`Could not find group rank: ${targetRankValue}`);

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
        throw new Error(`Roblox API Error (${patchRes.statusCode})`);
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
        const errEmbed = new EmbedBuilder().setDescription("Could not find your linked Roblox profile.").setColor('#E67E22');
        return interaction.channel ? interaction.channel.send({ embeds: [errEmbed] }) : interaction.editReply({ embeds: [errEmbed] });
    }

    if (!db.globalVerifiedUsers) db.globalVerifiedUsers = {};
    db.globalVerifiedUsers[member.id] = robloxUser.id;
    saveDB();

    if (!serverConfig.groupId) {
        const errEmbed = new EmbedBuilder().setDescription("Group ID is not configured.").setColor('#E67E22');
        return interaction.channel ? interaction.channel.send({ embeds: [errEmbed] }) : interaction.editReply({ embeds: [errEmbed] });
    }

    const rankValue = await getRobloxUserRank(robloxUser.id, serverConfig.groupId);
    const bindConfig = serverConfig.binds ? serverConfig.binds[String(rankValue)] : null;
    let assignedPrefix = "None";
    let targetRoleIds = [];

    if (bindConfig) {
        assignedPrefix = bindConfig.prefix ? `[${bindConfig.prefix.replace(/[\[\]]/g, '')}]` : "None";
        targetRoleIds = bindConfig.roleIds || (bindConfig.roleId ? [bindConfig.roleId] : []);
    }

    const formatPrefix = assignedPrefix !== "None" ? `${assignedPrefix} ` : "";
    await member.setNickname(`${formatPrefix}${robloxUser.username}`.substring(0, 32)).catch(() => {});
    
    const verifiedRole = member.guild.roles.cache.find(r => r.name === VERIFIED_ROLE_NAME);
    if (verifiedRole) await member.roles.add(verifiedRole).catch(() => {});

    let rolesAddedList = [];
    let rolesRemovedList = [];

    if (targetRoleIds.length > 0) {
        for (const rId of targetRoleIds) {
            if (!member.roles.cache.has(rId)) {
                await member.roles.add(rId).catch(() => {});
                rolesAddedList.push(`<@&${rId}>`);
            }
        }
    }

    for (const [rId, bind] of Object.entries(serverConfig.binds || {})) {
        if (parseInt(rId, 10) !== rankValue) {
            const structuralBinds = bind.roleIds || (bind.roleId ? [bind.roleId] : []);
            for (const oldId of structuralBinds) {
                if (member.roles.cache.has(oldId) && !targetRoleIds.includes(oldId)) {
                    await member.roles.remove(oldId).catch(() => {});
                    rolesRemovedList.push(`<@&${oldId}>`);
                }
            }
        }
    }

    const responseEmbed = new EmbedBuilder()
        .setTitle("Roles Synced")
        .setDescription(`Successfully updated configurations for **${robloxUser.username}**.`)
        .addFields(
            { name: "Group Rank", value: String(rankValue), inline: true },
            { name: "Prefix", value: assignedPrefix !== "None" ? assignedPrefix : "None", inline: true },
            { name: "Roles Added", value: rolesAddedList.join(', ') || "None", inline: false },
            { name: "Roles Removed", value: rolesRemovedList.join(', ') || "None", inline: false }
        )
        .setColor('#2F619E');
    
    return interaction.channel ? interaction.channel.send({ embeds: [responseEmbed] }) : interaction.editReply({ embeds: [responseEmbed] });
}

// ==========================================
// TICKET GENERATOR (VIDEO 1 EXACT REPLICA)
// ==========================================
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

        if (selectionLabel === 'verification') {
            // Step 1 Embed matching exact wording and style from Video 1
            const step1Embed = new EmbedBuilder()
                .setTitle("Roblox Verification")
                .setDescription(`Hello ${interaction.user},\n\nPlease type your **Roblox Username** below to start verification.\n\nType \`cancel\` at any time to close this channel.`)
                .setFooter({ text: "Verification System | Step 1 of 3" })
                .setColor('#2F619E');

            await ticketChannel.send({ embeds: [step1Embed] });
            activeSessions.set(ticketChannel.id, { step: 1, userId: interaction.user.id, robloxId: null, robloxUsername: null, verificationCode: "" });

            // Red confirmation reply in the original channel matching Video 1
            const video1NotifyEmbed = new EmbedBuilder()
                .setDescription(`Verification channel created. Please check ${ticketChannel} to verify your account.`)
                .setColor('#8C1D1D');

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ embeds: [video1NotifyEmbed] });
            } else {
                await interaction.reply({ embeds: [video1NotifyEmbed] });
            }
        } else {
            const cleanTitleLabel = selectionLabel.replace(/-/g, ' ').toUpperCase();
            const supportTicketEmbed = new EmbedBuilder()
                .setTitle(`${cleanTitleLabel} TICKET`)
                .setDescription(`Hello ${interaction.user},\n\nPlease describe your issue below details so staff can assist.\n\nType \`cancel\` at any time to close this channel.`)
                .setColor('#2F619E');

            await ticketChannel.send({ content: `${interaction.user}`, embeds: [supportTicketEmbed] });

            const standardNotifyEmbed = new EmbedBuilder()
                .setDescription(`Ticket generated: ${ticketChannel}`)
                .setColor('#2F619E');

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ embeds: [standardNotifyEmbed] });
            } else {
                await interaction.reply({ embeds: [standardNotifyEmbed] });
            }
        }

        const ticketLog = new EmbedBuilder()
            .setTitle("Ticket Created")
            .setDescription(`Ticket **${selectionLabel}** opened by ${interaction.user} in ${ticketChannel}.`)
            .setColor("#2F619E")
            .setTimestamp();
        await sendLog(interaction.guild, 'tickets', ticketLog);

    } catch (e) {
        const errorMsg = { embeds: [new EmbedBuilder().setDescription("Failed creating ticket channel.").setColor('#E67E22')], ephemeral: true };
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(errorMsg).catch(() => {});
        } else {
            await interaction.reply(errorMsg).catch(() => {});
        }
    }
}

// ==========================================
// CLIENT BUILD
// ==========================================
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
    } catch (e) {}
});

// ==========================================
// TEXT MESSAGE INPUT FLOWS & COMMANDS
// ==========================================
client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;

    const serverConfig = db[message.guild.id];
    if (!serverConfig) return;
    
    const authorAdminLevel = getAdminLevel(message.guild, message.member);

    // Support !verify command exactly like Video 1
    if (message.content.toLowerCase().startsWith('!verify')) {
        if (!serverConfig.ticketCategory) {
            return message.reply({ embeds: [new EmbedBuilder().setDescription("Ticket category not configured.").setColor('#E67E22')] });
        }
        const channels = await message.guild.channels.fetch().catch(() => null);
        if (channels) {
            const openCheck = channels.find(c => c && c.parentId === serverConfig.ticketCategory && c.type === ChannelType.GuildText && c.permissionOverwrites?.cache?.has(message.author.id));
            if (openCheck) {
                return message.reply({ embeds: [new EmbedBuilder().setDescription(`You already have an open verification ticket: ${openCheck}`).setColor('#E67E22')] });
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

    // Interactive ticket session handling
    if (activeSessions.has(message.channel.id)) {
        const session = activeSessions.get(message.channel.id);
        if (session.userId !== message.author.id) return;

        const input = message.content.trim();

        if (input.toLowerCase() === 'cancel') {
            await message.reply({ embeds: [new EmbedBuilder().setDescription("Canceled. Closing channel...").setColor('#E67E22')] });
            activeSessions.delete(message.channel.id);
            setTimeout(() => message.channel.delete().catch(() => {}), 3000);
            return;
        }

        // Step 1 -> Step 2
        if (session.step === 1) {
            const robloxUser = await getRobloxUser(input);
            if (!robloxUser) {
                return message.reply({ embeds: [new EmbedBuilder().setDescription("Roblox user not found. Try again or type `cancel`.").setColor('#E67E22')] });
            }
            session.robloxId = robloxUser.id;
            session.robloxUsername = robloxUser.username;
            session.step = 2;
            activeSessions.set(message.channel.id, session);

            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setTitle("Is this your account?")
                    .setDescription(`Please confirm if this is your account. Reply with **YES** or **NO**.`)
                    .addFields(
                        { name: "Username", value: robloxUser.username, inline: true },
                        { name: "User ID", value: String(robloxUser.id), inline: true },
                        { name: "Profile Link", value: `[View Profile](https://www.roblox.com/users/${robloxUser.id}/profile)`, inline: false }
                    )
                    .setFooter({ text: "Verification System | Step 2 of 3" })
                    .setColor('#2F619E')
            ]});
        }

        // Step 2 -> Step 3
        if (session.step === 2) {
            if (input.toLowerCase() === 'no') {
                session.step = 1;
                activeSessions.set(message.channel.id, session);
                return message.reply({ embeds: [new EmbedBuilder().setDescription("Type your correct Roblox Username below:").setColor('#2F619E')] });
            }
            if (input.toLowerCase() !== 'yes') {
                return message.reply({ embeds: [new EmbedBuilder().setDescription("Invalid response. Type **YES** or **NO**.").setColor('#E67E22')] });
            }

            const code = generateVerificationCode();
            session.verificationCode = code;
            session.step = 3;
            activeSessions.set(message.channel.id, session);

            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setTitle("Profile Verification")
                    .setDescription(`To verify you own this account, please copy the code below and paste it into your Roblox profile's **About** or **Description** section.`)
                    .addFields({ name: "Code to Copy", value: `${code}`, inline: false })
                    .setFooter({ text: "Once you have saved your Roblox profile, type 'DONE' here." })
                    .setColor('#2F619E')
            ]});
        }

        // Step 3 Verification Check
        if (session.step === 3) {
            if (input.toLowerCase() !== 'done') {
                return message.reply({ embeds: [new EmbedBuilder().setDescription("Type `DONE` when you have updated your Roblox description.").setColor('#E67E22')] });
            }

            const liveUser = await getRobloxUserById(session.robloxId);
            if (!liveUser || !liveUser.description.toLowerCase().includes(session.verificationCode.toLowerCase())) {
                return message.reply({ 
                    embeds: [new EmbedBuilder()
                        .setTitle("Verification Failed")
                        .setDescription(`The code was not found in your Roblox description.\n\nExpected:\n\`${session.verificationCode}\``)
                        .setColor('#E67E22')]
                });
            }

            const simulatedInteraction = { channel: message.channel };
            activeSessions.delete(message.channel.id);
            await executeUserUpdate(simulatedInteraction, message.member, serverConfig, session.robloxId);
            
            const logEmbed = new EmbedBuilder()
                .setTitle("User Verified")
                .setDescription(`${message.author} linked to Roblox user **${session.robloxUsername}** (${session.robloxId}).`)
                .setColor("#2F619E")
                .setTimestamp();
            await sendLog(message.guild, 'verification', logEmbed);

            setTimeout(() => message.channel.delete().catch(() => {}), 7000);
            return;
        }
    }

    // Auto Moderation for Protected Mentions
    if (authorAdminLevel < 1) {
        const tagsOwner = message.mentions.users.has(message.guild.ownerId);
        const tagsProtected = message.mentions.users.some(u => PROTECTED_USERS.includes(u.id));
        if (tagsOwner || tagsProtected) {
            try {
                await message.delete().catch(() => {});
                await message.member.timeout(24 * 60 * 60 * 1000, "Mentioned a protected user.").catch(() => {});
                
                const modEmbed = new EmbedBuilder()
                    .setTitle("Automated Timeout")
                    .setDescription(`User ${message.author} timed out for 24 hours for mentioning protected users.`)
                    .setColor("#E67E22")
                    .setTimestamp();
                await sendLog(message.guild, 'moderation', modEmbed);
                return;
            } catch (err) {}
        }
    }
});

// ==========================================
// INTERACTION ROUTER HANDLER
// ==========================================
client.on('interactionCreate', async interaction => {
    const guild = interaction.guild;
    const member = interaction.member;
    if (!guild) return;

    if (!db[guild.id]) {
        db[guild.id] = { groupId: null, binds: {}, adminUsers: {}, adminRoles: {}, ticketCategory: null, ticketCount: 0, robloxCookie: null, logChannels: {} };
    }
    const serverConfig = db[guild.id];
    const callerAdminLevel = getAdminLevel(guild, member);

    if (interaction.isChatInputCommand()) {
        
        if (interaction.commandName === 'set-cookie') {
            if (callerAdminLevel < 8) {
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Only the server owner can use this command.").setColor('#E67E22')], ephemeral: true });
            }
            serverConfig.robloxCookie = interaction.options.getString('cookie');
            saveDB();
            return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Successfully updated the cookie.").setColor('#2F619E')], ephemeral: true });
        }

        if (interaction.commandName === 'configure-group') {
            if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Permission denied.").setColor('#E67E22')], ephemeral: true });
            serverConfig.groupId = interaction.options.getInteger('group-id');
            saveDB();
            return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Bound to Group ID: **${serverConfig.groupId}**`).setColor('#2F619E')] });
        }

        if (interaction.commandName === 'set-log-channel') {
            if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Permission denied.").setColor('#E67E22')], ephemeral: true });
            const logType = interaction.options.getString('type');
            const targetChan = interaction.options.getChannel('channel');
            if (!serverConfig.logChannels) serverConfig.logChannels = {};
            serverConfig.logChannels[logType] = targetChan.id;
            saveDB();
            return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Logs for **${logType}** set to ${targetChan}`).setColor('#2F619E')] });
        }

        if (interaction.commandName === 'promote' || interaction.commandName === 'demote' || interaction.commandName === 'setrank') {
            if (callerAdminLevel < 2) {
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Permission denied.").setColor('#E67E22')], ephemeral: true });
            }
            await interaction.deferReply();
            
            const targetUserString = interaction.options.getString('username');
            const targetProfile = await getRobloxUser(targetUserString);
            if (!targetProfile) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("User not found.").setColor('#E67E22')] });

            const currentRank = await getRobloxUserRank(targetProfile.id, serverConfig.groupId);
            let finalRankTarget = currentRank;

            if (interaction.commandName === 'promote') finalRankTarget = currentRank + 1;
            else if (interaction.commandName === 'demote') finalRankTarget = currentRank - 1;
            else finalRankTarget = interaction.options.getInteger('rank-value');

            if (finalRankTarget < 1 || finalRankTarget > 255) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("Rank value out of range (1-255).").setColor('#E67E22')] });
            }

            try {
                const assignedRoleName = await changeRobloxRank(guild.id, targetProfile.id, finalRankTarget);
                
                const rankLog = new EmbedBuilder()
                    .setTitle(`Rank Shift: /${interaction.commandName}`)
                    .setDescription(`Admin ${interaction.user} updated **${targetProfile.username}**.`)
                    .addFields(
                        { name: "Old Rank", value: String(currentRank), inline: true },
                        { name: "New Rank", value: `${finalRankTarget} (${assignedRoleName})`, inline: true }
                    )
                    .setColor("#2F619E")
                    .setTimestamp();
                await sendLog(guild, 'moderation', rankLog);

                const matchedDiscordUser = Object.keys(db.globalVerifiedUsers || {}).find(key => db.globalVerifiedUsers[key] === targetProfile.id);
                if (matchedDiscordUser) {
                    const foundMember = await guild.members.fetch(matchedDiscordUser).catch(() => null);
                    if (foundMember) await executeUserUpdate(interaction, foundMember, serverConfig, targetProfile.id);
                }

                return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Updated **${targetProfile.username}** to **${assignedRoleName}** (${finalRankTarget}).`).setColor('#2F619E')] });
            } catch (err) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Error: ${err.message}`).setColor('#E67E22')] });
            }
        }

        if (interaction.commandName === 'send-panel') {
            if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Permission denied.").setColor('#E67E22')], ephemeral: true });
            const verifyEmbed = new EmbedBuilder()
                .setAuthor({ name: 'Royal Guard', iconURL: client.user.displayAvatarURL() })
                .setTitle("BRITISH ARMY VERIFICATION SYSTEM V5")
                .setDescription("Press the **Verify / Reverify** button to verify or reverify your ROBLOX account.")
                .setColor("#2F619E");

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('panel_trigger_verify').setLabel('Verify / Reverify').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('btn_update_roles').setLabel('Update Roles').setStyle(ButtonStyle.Secondary)
            );
            return interaction.reply({ embeds: [verifyEmbed], components: [actionRow] });
        }

        if (interaction.commandName === 'ticket') {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'panel') {
                if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Permission denied.").setColor('#E67E22')], ephemeral: true });
                const reportEmbed = new EmbedBuilder()
                    .setAuthor({ name: 'Royal Guard', iconURL: client.user.displayAvatarURL() })
                    .setTitle("REPORT TICKETS")
                    .setDescription("Press the 📑 **Create Ticket** button for tickets to report an incident or other users.")
                    .setColor("#E67E22");

                const otherEmbed = new EmbedBuilder()
                    .setAuthor({ name: 'Royal Guard', iconURL: client.user.displayAvatarURL() })
                    .setTitle("OTHER TICKETS")
                    .setDescription("Press the 📑 **Create Ticket** button for tickets regarding other matters.")
                    .setColor("#2F619E");

                const rowReport = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ticket_trigger_report').setLabel('Create Ticket').setStyle(ButtonStyle.Danger)
                );
                const rowOther = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ticket_trigger_other').setLabel('Create Ticket').setStyle(ButtonStyle.Success)
                );
                
                await interaction.reply({ embeds: [new EmbedBuilder().setDescription("Panels deployed.").setColor('#2F619E')], ephemeral: true });
                await interaction.channel.send({ embeds: [reportEmbed], components: [rowReport] });
                return await interaction.channel.send({ embeds: [otherEmbed], components: [rowOther] });
            }

            if (subcommand === 'configure') {
                if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Permission denied.").setColor('#E67E22')], ephemeral: true });
                serverConfig.ticketCategory = interaction.options.getChannel('category').id;
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Ticket category configured.").setColor('#2F619E')] });
            }
        }

        if (interaction.commandName === 'update') {
            await interaction.deferReply({ ephemeral: true });
            return executeUserUpdate(interaction, member, serverConfig);
        }
    }

    else if (interaction.isButton()) {
        const cooldownKey = `${interaction.user.id}_ticket_cooldown`;
        if (interaction.customId.startsWith('ticket_trigger_') || interaction.customId === 'panel_trigger_verify') {
            if (cooldowns.has(cooldownKey)) {
                const expirationTime = cooldowns.get(cooldownKey);
                const timeLeft = Math.ceil((expirationTime - Date.now()) / 1000);
                if (timeLeft > 0) {
                    return interaction.reply({ 
                        embeds: [new EmbedBuilder().setTitle("Warning - Cooldown").setDescription(`You're currently on a ${timeLeft}s cooldown!`).setColor('#E67E22')], 
                        ephemeral: true 
                    });
                }
            }
        }

        if (interaction.customId === 'panel_trigger_verify') {
            // FIX: Immediately defer reply publicly. This breaks Discord's 3-second limit 
            // and eliminates the stuck "Please wait" or "Interaction failed" bug!
            await interaction.deferReply();

            if (!serverConfig.ticketCategory) {
                return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("Ticket category not set.").setColor('#E67E22')] });
            }

            const channels = await interaction.guild.channels.fetch().catch(() => null);
            if (channels) {
                const openCheck = channels.find(c => c && c.parentId === serverConfig.ticketCategory && c.type === ChannelType.GuildText && c.permissionOverwrites?.cache?.has(interaction.user.id));
                if (openCheck) {
                    return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`You already have an open ticket: ${openCheck}`).setColor('#E67E22')] });
                }
            }

            cooldowns.set(cooldownKey, Date.now() + 18000); 
            return await generateFinalTicket(interaction, "verify", "verification", serverConfig.ticketCategory);
        }

        if (interaction.customId === 'ticket_trigger_report' || interaction.customId === 'ticket_trigger_other') {
            const isReport = interaction.customId === 'ticket_trigger_report';
            const dropEmbed = new EmbedBuilder().setTitle("Create Ticket").setDescription("Select what ticket you wish to create.").setColor("#2F619E");
            const selectionMenu = new StringSelectMenuBuilder().setCustomId('menu_select_unified').setPlaceholder('Select Ticket Type...');

            if (isReport) {
                selectionMenu.addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Report High Rank').setValue('report_high_rank').setDescription('Report a high ranking officer.'),
                    new StringSelectMenuOptionBuilder().setLabel('Report Exploiter').setValue('report_exploiter').setDescription('Report an exploiter.'),
                    new StringSelectMenuOptionBuilder().setLabel('Report Corruption').setValue('report_corruption').setDescription('Report corruption.'),
                    new StringSelectMenuOptionBuilder().setLabel('Report Abuser').setValue('report_abuser').setDescription('Report an abuser.'),
                    new StringSelectMenuOptionBuilder().setLabel('Report Rule Breaker').setValue('report_rule_breaker').setDescription('Report a rule breaker.')
                );
            } else {
                selectionMenu.addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Report Bug / Glitch').setValue('other_bug_glitch').setDescription('Report a glitch or bug.'),
                    new StringSelectMenuOptionBuilder().setLabel('Report Exploit Script').setValue('other_exploit_script').setDescription('Report an exploit script.'),
                    new StringSelectMenuOptionBuilder().setLabel('Developer Application').setValue('other_developer_app').setDescription('Apply to become a developer.'),
                    new StringSelectMenuOptionBuilder().setLabel('Alliance Application').setValue('other_alliance_app').setDescription('Apply to become an ally.')
                );
            }

            return interaction.reply({ embeds: [dropEmbed], components: [new ActionRowBuilder().addComponents(selectionMenu)], ephemeral: true });
        }

        if (interaction.customId === 'btn_update_roles') {
            await interaction.deferReply({ ephemeral: true });
            return await executeUserUpdate(interaction, member, serverConfig);
        }
    }

    else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'menu_select_unified') {
            await interaction.deferReply({ ephemeral: true });
            const selection = interaction.values[0];
            let cleanChannelPrefix = selection.startsWith('report_') ? "report" : "other";
            let selectionLabel = selection.replace('report_', '').replace('other_', '').replace(/_/g, '-');

            if (!serverConfig.ticketCategory) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("Ticket category not set.").setColor('#E67E22')] });

            const channels = await interaction.guild.channels.fetch().catch(() => null);
            if (channels) {
                const openCheck = channels.find(c => c && c.parentId === serverConfig.ticketCategory && c.type === ChannelType.GuildText && c.permissionOverwrites?.cache?.has(interaction.user.id));
                if (openCheck) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`You already have an open ticket: ${openCheck}`).setColor('#E67E22')] });
            }

            cooldowns.set(`${interaction.user.id}_ticket_cooldown`, Date.now() + 18000);
            return await generateFinalTicket(interaction, cleanChannelPrefix, selectionLabel, serverConfig.ticketCategory);
        }
    }
});

client.login(TOKEN);