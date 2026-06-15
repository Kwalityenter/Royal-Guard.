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

const activeSessions = new Map();
const ticketCooldowns = new Map();
const COOLDOWN_TIME = 10 * 1000; 

const randomWords = ["apple", "banana", "robot", "blue", "army", "up", "down", "left", "right", "yes", "no", "green", "tiger", "shadow", "alpha", "delta", "verification"];
function generateVerificationCode() {
    let shuffled = randomWords.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5).join(" ");
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

// ==========================================
// ROBLOX GROUP API MANAGEMENT PIPELINE
// ==========================================
async function getRobloxCsrf(cookie) {
    try {
        const res = await request('https://auth.roblox.com/v2/login', {
            method: 'POST',
            headers: { 'Cookie': `.ROBLOSECURITY=${cookie}`, 'Content-Type': 'application/json' }
        });
        return res.headers['x-csrf-token'] || null;
    } catch (e) { return null; }
}

async function setRobloxGroupRank(cookie, groupId, targetRobloxId, targetRankValue) {
    const csrf = await getRobloxCsrf(cookie);
    if (!csrf) return { success: false, error: "Failed to resolve authenticated X-CSRF validation context." };

    try {
        const rolesRes = await request(`https://groups.roblox.com/v1/groups/${groupId}/roles`);
        const rolesData = await rolesRes.body.json();
        const matchedRole = rolesData.roles.find(r => r.rank === targetRankValue);
        
        if (!matchedRole) return { success: false, error: `Rank number value ${targetRankValue} could not be located.` };

        const changeRes = await request(`https://groups.roblox.com/v1/groups/${groupId}/users/${targetRobloxId}`, {
            method: 'PATCH',
            headers: {
                'Cookie': `.ROBLOSECURITY=${cookie}`,
                'X-CSRF-Token': csrf,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ roleId: matchedRole.id })
        });

        if (changeRes.statusCode === 200) {
            return { success: true, roleName: matchedRole.name };
        } else {
            const errData = await changeRes.body.json().catch(() => ({}));
            return { success: false, error: errData.errors?.[0]?.message || `HTTP Error ${changeRes.statusCode}` };
        }
    } catch (e) { return { success: false, error: e.message }; }
}

async function getGroupRolesSorted(groupId) {
    try {
        const res = await request(`https://groups.roblox.com/v1/groups/${groupId}/roles`);
        const data = await res.body.json();
        if (data.roles) {
            return data.roles.sort((a, b) => a.rank - b.rank);
        }
    } catch (e) { console.error(e); }
    return [];
}

// ==========================================
// ROBLOX PROFILE ENGINE LOOKUPS
// ==========================================
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

async function executeUserUpdate(target, member, serverConfig, explicitUserId = null) {
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
        const errEmbed = new EmbedBuilder().setDescription("Could not find your linked Roblox profile. Match your name and try again.").setColor('#E67E22'); 
        if (target.send) return target.send({ embeds: [errEmbed] });
        return target.deferred || target.replied ? target.editReply({ embeds: [errEmbed] }) : target.reply({ embeds: [errEmbed], ephemeral: true });
    }

    if (!db.globalVerifiedUsers) db.globalVerifiedUsers = {};
    db.globalVerifiedUsers[member.id] = robloxUser.id;
    saveDB();

    const rankValue = await getRobloxUserRank(robloxUser.id, serverConfig.groupId);
    const bindConfig = serverConfig.binds ? serverConfig.binds[String(rankValue)] : null;
    let assignedPrefix = "None";
    let targetRoleIds = [];

    if (bindConfig) {
        assignedPrefix = bindConfig.prefix ? `[${bindConfig.prefix.replace(/[\[\]]/g, '')}]` : "None";
        // Handle both legacy single configs and new multi-role array systems gracefully
        targetRoleIds = bindConfig.roleIds || (bindConfig.roleId ? [bindConfig.roleId] : []);
    }

    const formatPrefix = assignedPrefix !== "None" ? `${assignedPrefix} ` : "";
    await member.setNickname(`${formatPrefix}${robloxUser.username}`.substring(0, 32)).catch(() => {});
    
    const verifiedRole = member.guild.roles.cache.find(r => r.name === VERIFIED_ROLE_NAME);
    if (verifiedRole) await member.roles.add(verifiedRole).catch(() => {});

    let rolesAddedList = [];
    let rolesRemovedList = [];

    // Add all roles bound to current group rank tier
    if (targetRoleIds.length > 0) {
        for (const rId of targetRoleIds) {
            if (!member.roles.cache.has(rId)) {
                await member.roles.add(rId).catch(() => {});
                rolesAddedList.push(`<@&${rId}>`);
            }
        }
    }

    // Clean up old rank bindings the user no longer belongs to
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
        .setTitle(target.send ? "Verification Successful" : "Roles Update")
        .setDescription(target.send ? `You have been verified as ${robloxUser.username}.` : `Successfully updated user roles`)
        .addFields(
            { name: "Prefix", value: assignedPrefix !== "None" ? assignedPrefix : "None", inline: true },
            { name: "Nickname", value: robloxUser.username, inline: true },
            { name: "Roles Added", value: rolesAddedList.join(', ') || "None", inline: false },
            { name: "Roles Removed", value: rolesRemovedList.join(', ') || "None", inline: false }
        )
        .setColor('#2F619E'); 

    if (target.send) {
        responseEmbed.setFooter({ text: "Success! Deleting this channel in 5 seconds..." });
        await target.send({ embeds: [responseEmbed] });
        setTimeout(() => { target.delete().catch(() => {}); }, 5000);
        return;
    }
    
    return target.deferred || target.replied ? target.editReply({ embeds: [responseEmbed] }) : target.reply({ embeds: [responseEmbed], ephemeral: true });
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

// ==========================================
// CHAT CONVERSATION PROCESSING (STEP 1-3)
// ==========================================
client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;

    const serverConfig = db[message.guild.id];
    const authorAdminLevel = getAdminLevel(message.guild, message.member);

    if (activeSessions.has(message.channel.id)) {
        const session = activeSessions.get(message.channel.id);
        if (session.userId !== message.author.id) return;

        const input = message.content.trim();

        if (input.toLowerCase() === 'cancel') {
            await message.reply({ embeds: [new EmbedBuilder().setDescription("Verification session canceled. Deleting channel...").setColor('#E67E22')] }); 
            activeSessions.delete(message.channel.id);
            setTimeout(() => message.channel.delete().catch(() => {}), 3000);
            return;
        }

        if (session.step === 1) {
            const robloxUser = await getRobloxUser(input);
            if (!robloxUser) {
                return message.reply({ embeds: [new EmbedBuilder().setDescription("Roblox username not found. Please try again or type `cancel`.").setColor('#E67E22')] }); 
            }

            session.robloxId = robloxUser.id;
            session.robloxUsername = robloxUser.username;
            session.step = 2;
            activeSessions.set(message.channel.id, session);

            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setTitle("Is this your account?")
                    .setDescription(`Please confirm if this is your account.\nReply with **YES** or **NO**.`)
                    .addFields(
                        { name: "Username", value: robloxUser.username, inline: true },
                        { name: "User ID", value: String(robloxUser.id), inline: true },
                        { name: "Profile Link", value: `[View Profile](https://www.roblox.com/users/${robloxUser.id}/profile)`, inline: false }
                    )
                    .setFooter({ text: "Verification System | Step 2 of 3" })
                    .setColor('#2F619E') 
            ]});
        }

        if (session.step === 2) {
            if (input.toLowerCase() === 'no') {
                session.step = 1;
                activeSessions.set(message.channel.id, session);
                return message.reply({ embeds: [new EmbedBuilder().setDescription("Let's restart. Please type your correct Roblox Username below:").setColor('#2F619E')] }); 
            }
            if (input.toLowerCase() !== 'yes') {
                return message.reply({ embeds: [new EmbedBuilder().setDescription("Invalid response. Please type **YES** or **NO**.").setColor('#E67E22')] }); 
            }

            const code = generateVerificationCode();
            session.verificationCode = code;
            session.step = 3;
            activeSessions.set(message.channel.id, session);

            return message.reply({ embeds: [
                new EmbedBuilder()
                    .setTitle("Profile Verification")
                    .setDescription(`To verify you own this account, please copy the code below and paste it into your Roblox profile's **About** section or **Description** section.`)
                    .addFields({ name: "Code to Copy", value: `\`\`\`\n${code}\n\`\`\``, inline: false })
                    .setFooter({ text: "Once you have saved your Roblox profile, type 'DONE' here.\nVerification System | Step 3 of 3" })
                    .setColor('#2F619E') 
            ]});
        }

        if (session.step === 3) {
            if (input.toLowerCase() !== 'done') {
                return message.reply({ embeds: [new EmbedBuilder().setDescription("Type `DONE` when you've updated your Roblox profile description section.").setColor('#E67E22')] }); 
            }

            const liveUser = await getRobloxUserById(session.robloxId);
            if (!liveUser || !liveUser.description.toLowerCase().includes(session.verificationCode.toLowerCase())) {
                return message.reply({ 
                    embeds: [new EmbedBuilder()
                        .setTitle("Verification Check Failed")
                        .setDescription(`The verification code was not detected in your Roblox description.\n\nExpected code:\n\`${session.verificationCode}\`\n\nPlease verify you saved it correctly and type \`DONE\` again.`)
                        .setColor('#E67E22')] 
                });
            }

            activeSessions.delete(message.channel.id);
            return await executeUserUpdate(message.channel, message.member, serverConfig, session.robloxId);
        }
        return;
    }

    if (authorAdminLevel < 1) { 
        const pingsOwner = message.mentions.users.has(message.guild.ownerId);
        const containsProtectedPing = message.mentions.users.some(user => PROTECTED_USERS.includes(user.id));
        if (pingsOwner || containsProtectedPing) {
            try {
                await message.delete().catch(() => {}); 
                await message.member.timeout(24 * 60 * 60 * 1000, "Mentioned a protected user.").catch(() => {});
                return; 
            } catch (e) { console.error(e); }
        }
    }
});

async function generateFinalTicket(interaction, channelName, selectionLabel, categoryId) {
    try {
        const ticketChannel = await interaction.guild.channels.create({
            name: `${channelName}-${interaction.user.username.toLowerCase()}`,
            type: ChannelType.GuildText,
            parent: categoryId,
            permissionOverwrites: [
                { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        if (selectionLabel === 'verification') {
            const step1Embed = new EmbedBuilder()
                .setTitle("Roblox Verification")
                .setDescription(`Hello ${interaction.user},\n\nPlease type your **Roblox Username** below to start verification.\n\nType \`cancel\` at any time to close this channel.`)
                .setFooter({ text: "Verification System | Step 1 of 3" })
                .setColor('#2F619E'); 

            await ticketChannel.send({ content: `${interaction.user}`, embeds: [step1Embed] });
            activeSessions.set(ticketChannel.id, { step: 1, userId: interaction.user.id, robloxId: null, robloxUsername: null, verificationCode: "" });
        } else {
            const genericSupportEmbed = new EmbedBuilder()
                .setTitle(`${selectionLabel.toUpperCase()} HELP TICKET`)
                .setDescription(`Hello ${interaction.user},\n\nThank you for opening a ticket regarding **${selectionLabel.replace(/-/g, ' ')}**. Please supply all context below. Support staff will be with you shortly.`)
                .setColor('#2F619E'); 

            await ticketChannel.send({ content: `${interaction.user}`, embeds: [genericSupportEmbed] });
        }
    } catch (e) { console.error("Ticket Generation Failure:", e); }
}

// ==========================================
// INTERACTION CONTROLLER ROUTER
// ==========================================
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

            const verifyEmbed = new EmbedBuilder()
                .setAuthor({ name: 'Royal Guard', iconURL: client.user.displayAvatarURL() })
                .setTitle("BRITISH ARMY VERIFICATION SYSTEM V5")
                .setDescription("Press the buttons below to verify your ROBLOX account or access our help desks.")
                .setColor("#154261"); 

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_roblox_login').setLabel('Verify via ROBLOX Login').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('panel_trigger_verify').setLabel('Verify via Verification Tickets').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('btn_update_roles').setLabel('Update Roles').setStyle(ButtonStyle.Success)
            );

            await interaction.channel.send({ embeds: [verifyEmbed], components: [actionRow] });
            return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Verification System V5 interface deployed successfully.").setColor('#2F619E')], ephemeral: true }); 
        }

        if (interaction.commandName === 'ticket') {
            const subcommand = interaction.options.getSubcommand();
            
            if (subcommand === 'panel') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && callerAdminLevel === 0) {
                    return interaction.reply({ embeds: [new EmbedBuilder().setDescription("You do not have permission to use this command.").setColor('#E67E22')], ephemeral: true }); 
                }

                const reportEmbed = new EmbedBuilder()
                    .setAuthor({ name: 'Royal Guard', iconURL: client.user.displayAvatarURL() })
                    .setTitle("REPORT TICKETS")
                    .setDescription("Press the 📩 **Create Ticket** button to report an incident or other users to our staff.")
                    .setColor("#992D22"); 
                const reportRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ticket_trigger_reports').setLabel('Create Ticket').setStyle(ButtonStyle.Danger)
                );

                const otherEmbed = new EmbedBuilder()
                    .setAuthor({ name: 'Royal Guard', iconURL: client.user.displayAvatarURL() })
                    .setTitle("OTHER TICKETS")
                    .setDescription("Press the 📩 **Create Ticket** button for tickets regarding other matters.")
                    .setColor("#2C3E50"); 
                const otherRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ticket_trigger_others').setLabel('Create Ticket').setStyle(ButtonStyle.Danger)
                );

                await interaction.channel.send({ embeds: [reportEmbed], components: [reportRow] });
                await interaction.channel.send({ embeds: [otherEmbed], components: [otherRow] });

                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Administrative ticketing panels deployed successfully.").setColor('#2F619E')], ephemeral: true }); 
            }

            if (subcommand === 'configure') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && callerAdminLevel === 0) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Missing permissions.").setColor('#E67E22')], ephemeral: true }); 
                serverConfig.ticketCategory = interaction.options.getChannel('category').id;
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Ticket and verification category setup updated successfully.").setColor('#2F619E')] }); 
            }
        }

        if (interaction.commandName === 'config') {
            if (callerAdminLevel < 8 && interaction.user.id !== String(OWNER_ID)) {
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access Denied.").setColor('#E67E22')], ephemeral: true }); 
            }
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'cookie') {
                serverConfig.robloxCookie = interaction.options.getString('value');
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("🔑 Authenticated `.ROBLOSECURITY` system cookie cached securely.").setColor('#2F619E')], ephemeral: true }); 
            }
        }

        if (interaction.commandName === 'setrank') {
            if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access Denied. Tier 4 Clearance required.").setColor('#E67E22')], ephemeral: true }); 
            if (!serverConfig.robloxCookie) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Roblox account cookie missing. Use `/config cookie`.").setColor('#E67E22')], ephemeral: true }); 
            if (!serverConfig.groupId) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("No active Group ID bound.").setColor('#E67E22')], ephemeral: true }); 

            await interaction.deferReply();
            const targetUser = interaction.options.getUser('user');
            const targetRank = interaction.options.getInteger('rankid');

            const targetRobloxId = db.globalVerifiedUsers[targetUser.id];
            if (!targetRobloxId) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("Target profile does not contain a global verification trace.").setColor('#E67E22')] }); 

            const result = await setRobloxGroupRank(serverConfig.robloxCookie, serverConfig.groupId, targetRobloxId, targetRank);
            if (!result.success) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Execution Failure: ${result.error}`).setColor('#E67E22')] }); 

            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            if (targetMember) await executeUserUpdate(interaction, targetMember, serverConfig, targetRobloxId);

            return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Successfully shifted Roblox account profile rank to **${result.roleName}** [Rank ${targetRank}].`).setColor('#2F619E')] }); 
        }

        if (interaction.commandName === 'promote') {
            if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access Denied. Tier 4 Clearance required.").setColor('#E67E22')], ephemeral: true }); 
            if (!serverConfig.robloxCookie) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Roblox account cookie configuration missing.").setColor('#E67E22')], ephemeral: true }); 
            
            await interaction.deferReply();
            const targetUser = interaction.options.getUser('user');
            const targetRobloxId = db.globalVerifiedUsers[targetUser.id];
            if (!targetRobloxId) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("Profile trace missing links.").setColor('#E67E22')] }); 

            const currentRank = await getRobloxUserRank(targetRobloxId, serverConfig.groupId);
            const rolesList = await getGroupRolesSorted(serverConfig.groupId);
            if (rolesList.length === 0) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("Failed to fetch group roles layout.").setColor('#E67E22')] }); 

            const currentIdx = rolesList.findIndex(r => r.rank === currentRank);
            if (currentIdx === -1 || currentIdx >= rolesList.length - 1) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("User is already at maximum possible group promotion tier.").setColor('#E67E22')] }); 

            const nextRole = rolesList[currentIdx + 1];
            const result = await setRobloxGroupRank(serverConfig.robloxCookie, serverConfig.groupId, targetRobloxId, nextRole.rank);
            if (!result.success) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Execution Failure: ${result.error}`).setColor('#E67E22')] }); 

            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            if (targetMember) await executeUserUpdate(interaction, targetMember, serverConfig, targetRobloxId);

            return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`📈 Promoted profile tier successfully to **${nextRole.name}** [Rank ${nextRole.rank}].`).setColor('#2F619E')] }); 
        }

        if (interaction.commandName === 'demote') {
            if (callerAdminLevel < 4) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access Denied. Tier 4 Clearance required.").setColor('#E67E22')], ephemeral: true }); 
            if (!serverConfig.robloxCookie) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Roblox account cookie configuration missing.").setColor('#E67E22')], ephemeral: true }); 

            await interaction.deferReply();
            const targetUser = interaction.options.getUser('user');
            const targetRobloxId = db.globalVerifiedUsers[targetUser.id];
            if (!targetRobloxId) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("Profile trace missing global links.").setColor('#E67E22')] }); 

            const currentRank = await getRobloxUserRank(targetRobloxId, serverConfig.groupId);
            const rolesList = await getGroupRolesSorted(serverConfig.groupId);
            if (rolesList.length === 0) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("Failed to fetch group roles layout.").setColor('#E67E22')] }); 

            const currentIdx = rolesList.findIndex(r => r.rank === currentRank);
            if (currentIdx === -1 || currentIdx <= 0) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription("User is already at lowest group tier limit.").setColor('#E67E22')] }); 

            const prevRole = rolesList[currentIdx - 1];
            const result = await setRobloxGroupRank(serverConfig.robloxCookie, serverConfig.groupId, targetRobloxId, prevRole.rank);
            if (!result.success) return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Execution Failure: ${result.error}`).setColor('#E67E22')] }); 

            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            if (targetMember) await executeUserUpdate(interaction, targetMember, serverConfig, targetRobloxId);

            return interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`📉 Demoted profile tier successfully to **${prevRole.name}** [Rank ${prevRole.rank}].`).setColor('#2F619E')] }); 
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
                if (tu) { if(!serverConfig.adminUsers) serverConfig.adminUsers = {}; serverConfig.adminUsers[tu.id] = lvl; }
                if (tr) { if(!serverConfig.adminRoles) serverConfig.adminRoles = {}; serverConfig.adminRoles[tr.id] = lvl; }
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Admin levels updated successfully.").setColor('#2F619E')] }); 
            }
        }

        if (interaction.commandName === 'rankbinds') {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'view') {
                let lines = [];
                if (serverConfig.binds) {
                    Object.entries(serverConfig.binds).forEach(([rId, d]) => {
                        const functionalRoles = d.roleIds ? d.roleIds.map(id => `<@&${id}>`).join(', ') : (d.roleId ? `<@&${d.roleId}>` : "None");
                        lines.push(`**Rank ${rId}**: ${functionalRoles} [${d.prefix || "None"}]`);
                    });
                }
                return interaction.reply({ embeds: [new EmbedBuilder().setTitle("Rank Mappings").setDescription(lines.join("\n") || "No bindings configured.").setColor('#2F619E')] }); 
            }
            if (callerAdminLevel === 0) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Access denied.").setColor('#E67E22')], ephemeral: true }); 
            if (subcommand === 'add') {
                serverConfig.groupId = interaction.options.getInteger('groupid');
                if (!serverConfig.binds) serverConfig.binds = {};
                
                const rankKey = String(interaction.options.getInteger('rankid'));
                const prefixVal = interaction.options.getString('prefix');
                
                const r1 = interaction.options.getRole('role').id;
                const r2 = interaction.options.getRole('role2')?.id;
                const r3 = interaction.options.getRole('role3')?.id;
                
                const gatheredRoles = [...new Set([r1, r2, r3].filter(Boolean))];

                serverConfig.binds[rankKey] = { 
                    prefix: prefixVal, 
                    roleIds: gatheredRoles 
                };
                
                saveDB();
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription(`Rank binding rule updated with ${gatheredRoles.length} Discord roles successfully.`).setColor('#2F619E')] }); 
            }
        }

        if (interaction.commandName === 'update') {
            if (!serverConfig.groupId) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Roblox systems are not linked.").setColor('#E67E22')], ephemeral: true }); 
            await interaction.deferReply();
            return executeUserUpdate(interaction, member, serverConfig);
        }
    }

    // ==========================================
    // COOLDOWN & INTERACTION BUTTON PARSERS
    // ==========================================
    else if (interaction.isButton()) {
        if (['panel_trigger_verify', 'ticket_trigger_reports', 'ticket_trigger_others', 'btn_roblox_login', 'btn_update_roles'].includes(interaction.customId)) {
            
            if (interaction.customId === 'btn_roblox_login') {
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("OAuth Roblox login method is currently offline. Please use **Verify via Verification Tickets** to continue.").setColor('#E67E22')], ephemeral: true }); 
            }

            if (interaction.customId === 'btn_update_roles') {
                if (!serverConfig.groupId) return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Roblox backend integration systems are not linked on this server instance.").setColor('#E67E22')], ephemeral: true }); 
                await interaction.deferReply({ ephemeral: true });
                return executeUserUpdate(interaction, member, serverConfig);
            }

            if (!serverConfig.ticketCategory) {
                return interaction.reply({ embeds: [new EmbedBuilder().setDescription("Configuration error: Missing parent category channel. Run `/ticket configure`.").setColor('#E67E22')], ephemeral: true }); 
            }

            const lastUsed = ticketCooldowns.get(interaction.user.id);
            const now = Date.now();
            if (lastUsed && (now - lastUsed < COOLDOWN_TIME)) {
                return interaction.reply({
                    content: "Please wait before opening another ticket.", 
                    ephemeral: true
                });
            }

            ticketCooldowns.set(interaction.user.id, now);

            if (interaction.customId === 'panel_trigger_verify') {
                await interaction.deferReply({ ephemeral: true });
                serverConfig.ticketCount = (serverConfig.ticketCount || 0) + 1;
                saveDB();

                await interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Verification channel created. Please check...`).setColor('#2F619E')] }); 
                await generateFinalTicket(interaction, "verify", "verification", serverConfig.ticketCategory);
                return;
            }

            let selectMenu = new StringSelectMenuBuilder().setMinValues(1).setMaxValues(1);
            let embedTitle = "Create Ticket";

            if (interaction.customId === 'ticket_trigger_reports') {
                embedTitle = "Create Report Ticket";
                selectMenu.setCustomId('menu_select_report').setPlaceholder('Select Ticket Type').addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Report High Rank').setDescription('Report a high ranking officer.').setValue('report_high_rank'),
                    new StringSelectMenuOptionBuilder().setLabel('Report Exploiter').setDescription('Report an exploiter in game to our moderation team.').setValue('report_exploiter'),
                    new StringSelectMenuOptionBuilder().setLabel('Report Corruption').setDescription('Report a corrupted user.').setValue('report_corruption'),
                    new StringSelectMenuOptionBuilder().setLabel('Report Abuser').setDescription('Report an abuser.').setValue('report_abuser'),
                    new StringSelectMenuOptionBuilder().setLabel('Report Rule Breaker').setDescription('Report a user breaking server rules.').setValue('report_rule_breaker')
                );
            } else {
                embedTitle = "Create Support Ticket";
                selectMenu.setCustomId('menu_select_other').setPlaceholder('Select Ticket Type').addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Report Bug / Glitch').setDescription('Report an in game / discord glitch or bug to our developers.').setValue('other_bug_glitch'),
                    new StringSelectMenuOptionBuilder().setLabel('Report Exploit Script').setDescription('Report an exploit script or vulnerability to our developers.').setValue('other_exploit_script'),
                    new StringSelectMenuOptionBuilder().setLabel('Developer Application').setDescription('Apply to become a developer for British Army.').setValue('other_developer_application'),
                    new StringSelectMenuOptionBuilder().setLabel('Alliance Application').setDescription('Apply to become an ally with the British Army.').setValue('other_alliance_application')
                );
            }

            const promptRow = new ActionRowBuilder().addComponents(selectMenu);
            return interaction.reply({ 
                embeds: [new EmbedBuilder().setAuthor({ name: 'Royal Guard', iconURL: client.user.displayAvatarURL() }).setTitle(embedTitle).setDescription("Please select what ticket you wish to create.").setColor('#2F619E')], 
                components: [promptRow], 
                ephemeral: true 
            });
        }
    }

    else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'menu_select_report' || interaction.customId === 'menu_select_other') {
            await interaction.deferReply({ ephemeral: true });

            const selection = interaction.values[0];
            let cleanChannelName = "ticket";
            let selectionLabel = "support";

            if (selection.startsWith('report_')) {
                selectionLabel = selection.replace('report_', '').replace(/_/g, '-');
                cleanChannelName = `report-${selectionLabel}`;
            } else if (selection.startsWith('other_')) {
                selectionLabel = selection.replace('other_', '').replace(/_/g, '-');
                cleanChannelName = `other-${selectionLabel}`;
            }

            serverConfig.ticketCount = (serverConfig.ticketCount || 0) + 1;
            saveDB();

            await interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`Generating your request channel...`).setColor('#2F619E')] }); 
            await generateFinalTicket(interaction, cleanChannelName, selectionLabel, serverConfig.ticketCategory);
        }
    }
});

client.login(TOKEN);