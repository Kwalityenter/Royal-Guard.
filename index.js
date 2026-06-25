// ==========================================
// CONFIGURATION & CUSTOMIZATION
// ==========================================
const EMBED_CONFIG = {
    primaryColor: "#0055ff",
    errorColor: "#cc0000",
    neutralColor: "#2b2d31",
    loadingColor: "#ffaa00",
    authorName: "Royal Guard",
    footerText: "Royal Guard Services @ 2026. All Rights Reserved",
    
    // Panel Texts
    verificationTitle: "BRITISH ARMY VERIFICATION SYSTEM V1",
    verificationDescription: "Press the Verify via ROBLOX Login button to verify via OAuth2. Press the Verify via ROBLOX Game button to verify or reverify your ROBLOX account. Press the Update Roles button to update your Discord roles.",
    
    reportPanelTitle: "Royal Guard",
    reportPanelDescription: "REPORT TICKETS\n\nPress the Create Ticket button for tickets to report an incident or other users.",
    
    otherPanelTitle: "Royal Guard",
    otherPanelDescription: "OTHER TICKETS\n\nPress the Create Ticket button for tickets regarding other matters."
};

// Admin Level Permissions Descriptions
const LEVEL_PERMISSIONS = {
    10: "Absolute Control, Manage Admins (Server Owner Level)",
    9: "Full Bot Configurations, Deploy System Panels",
    8: "High Ticket Management, Update System Configurations",
    7: "Manage Channels & Overrides, Delete Active Tickets",
    6: "Middle Management Support, Access Staff Commands",
    5: "Run Advanced Background Audits & Member Inquiries",
    4: "Run Basic Background Checks (!bgcheck)",
    3: "Claim and Handle Support / Report Tickets",
    2: "Claim and Handle Basic Verification Tickets",
    1: "View Internal Restricted Log Channels"
};
// ==========================================

const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ChannelType, 
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');
const fs = require('fs');
const axios = require('axios');
const mongoose = require('mongoose');

const configPath = './config.json';
let CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ==========================================
// DATABASE SCHEMAS
// ==========================================
const guildConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    ticketCategoryId: { type: String, default: "" },
    verifyCategoryId: { type: String, default: "" }
});
const GuildConfig = mongoose.model('GuildConfig', guildConfigSchema);

const adminSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    targetId: { type: String, required: true, unique: true }, // User ID or Role ID
    type: { type: String, enum: ['user', 'role'], required: true },
    level: { type: Number, required: true, min: 1, max: 10 }
});
const Admin = mongoose.model('Admin', adminSchema);

// Helper function to find a user's admin level
async function getAdminLevel(member, guild) {
    if (member.id === guild.ownerId) return 10; // Server Owner is always level 10
    
    // Check if the individual user is assigned an admin level
    const userAdmin = await Admin.findOne({ guildId: guild.id, targetId: member.id, type: 'user' });
    if (userAdmin) return userAdmin.level;

    // Check if any of the user's roles are assigned an admin level
    const roleIds = member.roles.cache.map(role => role.id);
    const roleAdmins = await Admin.find({ guildId: guild.id, targetId: { $in: roleIds }, type: 'role' });
    if (roleAdmins.length > 0) {
        return Math.max(...roleAdmins.map(a => a.level));
    }

    return 0; 
}

function generateVerificationCode() {
    const words = ["verification", "blue", "up", "right", "down", "yes", "robot", "army", "tiger", "alpha"];
    let code = "";
    for (let i = 0; i < 5; i++) {
        code += words[Math.floor(Math.random() * words.length)] + " ";
    }
    return code.trim();
}

// ==========================================
// COMMAND DECLARATIONS
// ==========================================
const commands = [
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Ticket management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('config')
                .setDescription('Set the category for support tickets')
                .addChannelOption(option => 
                    option.setName('category')
                        .setDescription('The category channel')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('panel')
                .setDescription('Send the ticket panels to the channel')),
    new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Verification management commands')
        .addSubcommandGroup(group =>
            group
                .setName('ticket')
                .setDescription('Configure verification settings')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('config')
                        .setDescription('Set the category for verification tickets')
                        .addChannelOption(option => 
                            option.setName('category')
                                .setDescription('The category channel')
                                .addChannelTypes(ChannelType.GuildCategory)
                                .setRequired(true)))),
    new SlashCommandBuilder()
        .setName('send')
        .setDescription('Send panels')
        .addSubcommand(subcommand =>
            subcommand
                .setName('panel')
                .setDescription('Send the main verification panel')),
    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Manage bot admins and permission levels')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add an admin level to a user or role')
                .addIntegerOption(option => option.setName('level').setDescription('Admin level (1-10)').setRequired(true).setMinValue(1).setMaxValue(10))
                .addUserOption(option => option.setName('user').setDescription('Target user').setRequired(false))
                .addRoleOption(option => option.setName('role').setDescription('Target role').setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Remove a user or role from the admin list')
                .addUserOption(option => option.setName('user').setDescription('Target user').setRequired(false))
                .addRoleOption(option => option.setName('role').setDescription('Target role').setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View the list of server admins'))
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    
    if (!CONFIG.CLIENT_ID || !CONFIG.GUILD_ID || !CONFIG.MONGO_URI) {
        console.error("CRITICAL ERROR: Missing configuration keys in config.json.");
        return;
    }

    mongoose.connect(CONFIG.MONGO_URI)
        .then(() => console.log('Connected to MongoDB.'))
        .catch(err => console.error('MongoDB connection error:', err));

    const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
    try {
        await rest.put(
            Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID),
            { body: commands },
        );
        console.log('Successfully registered global application slash commands.');
    } catch (error) {
        console.error(error);
    }
});

// ==========================================
// TEXT MESSAGE EVENTS (!bgcheck)
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.toLowerCase().startsWith('!bgcheck')) {
        const userLevel = await getAdminLevel(message.member, message.guild);
        if (userLevel < 4) {
            return message.reply("❌ You need to be at least **Admin Level 4** to run a background check.");
        }

        const loadingEmbed = new EmbedBuilder()
            .setTitle("Background Checking")
            .setDescription("Please hold on whilst we background check the user.")
            .setColor(EMBED_CONFIG.loadingColor);

        const initialMsg = await message.channel.send({ content: `Hello ${message.author},`, embeds: [loadingEmbed] });

        setTimeout(async () => {
            const page1 = new EmbedBuilder()
                .setTitle(`${message.author.username} Background Check`)
                .setDescription("**MEDAL**\nNone\n\n**LEVEL**\nNone\n\n**Community Member**\nNone\n\n**RANKS**\nNone\n\n**Alerts**\n* [This user is new to our discord server.]\n\nViewing Page 1 / 3")
                .setColor(EMBED_CONFIG.neutralColor);

            await initialMsg.edit({ embeds: [page1] });
        }, 3000);
    }
});

// ==========================================
// SLASH COMMANDS & INTERACTION HANDLERS
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;
        const userAdminLevel = await getAdminLevel(interaction.member, interaction.guild);

        // Standard permission check for setup/admin commands
        if (['ticket', 'verify', 'send', 'admin'].includes(commandName)) {
            if (userAdminLevel < 7 && commandName !== 'admin' && options.getSubcommand() !== 'view') {
                return interaction.reply({ content: "❌ You don't have permission to edit bot settings (Minimum Level 7 required).", ephemeral: true });
            }
        }

        // --- /admin add ---
        if (commandName === 'admin' && options.getSubcommand() === 'add') {
            const assignedLevel = options.getInteger('level');
            const targetUser = options.getUser('user');
            const targetRole = options.getRole('role');

            if (userAdminLevel < 10) {
                return interaction.reply({ content: "❌ Only the Server Owner (Admin Level 10) can manage admin permissions.", ephemeral: true });
            }

            if (!targetUser && !targetRole) {
                return interaction.reply({ content: "❌ Please mention a user or select a role to make an admin.", ephemeral: true });
            }

            const targetId = targetUser ? targetUser.id : targetRole.id;
            const targetType = targetUser ? 'user' : 'role';
            const mention = targetUser ? `<@${targetUser.id}>` : `<@&${targetRole.id}>`;

            await Admin.findOneAndUpdate(
                { guildId: interaction.guild.id, targetId: targetId },
                { type: targetType, level: assignedLevel },
                { upsert: true, new: true }
            );

            return interaction.reply({ content: `✅ Successfully set ${mention} to **Admin Level ${assignedLevel}**!`, ephemeral: true });
        }

        // --- /admin delete ---
        if (commandName === 'admin' && options.getSubcommand() === 'delete') {
            const targetUser = options.getUser('user');
            const targetRole = options.getRole('role');

            if (userAdminLevel < 10) {
                return interaction.reply({ content: "❌ Only the Server Owner (Admin Level 10) can manage admin permissions.", ephemeral: true });
            }

            if (!targetUser && !targetRole) {
                return interaction.reply({ content: "❌ Please mention a user or select a role to remove from admins.", ephemeral: true });
            }

            const targetId = targetUser ? targetUser.id : targetRole.id;
            const mention = targetUser ? `<@${targetUser.id}>` : `<@&${targetRole.id}>`;

            const deletedRecord = await Admin.findOneAndDelete({ guildId: interaction.guild.id, targetId: targetId });

            if (!deletedRecord) {
                return interaction.reply({ content: `❌ ${mention} is not in the admin list.`, ephemeral: true });
            }

            return interaction.reply({ content: `✅ Successfully removed ${mention} from the admin list.`, ephemeral: true });
        }

        // --- /admin view ---
        if (commandName === 'admin' && options.getSubcommand() === 'view') {
            await interaction.deferReply();
            
            const allAdmins = await Admin.find({ guildId: interaction.guild.id }).sort({ level: -1 });
            
            const viewEmbed = new EmbedBuilder()
                .setTitle(`[ABA] Admins List`)
                .setDescription(`Viewing all server admins for **${interaction.guild.name}**`)
                .setColor(EMBED_CONFIG.neutralColor)
                .setFooter({ text: EMBED_CONFIG.footerText });

            // Initialize fields for levels 1-10
            let adminGroups = {};
            for (let i = 10; i >= 1; i--) {
                adminGroups[i] = [];
            }

            // Lock Server Owner to Level 10 naturally
            adminGroups[10].push(`<@${interaction.guild.ownerId}> *(Server Owner)*`);

            allAdmins.forEach(adm => {
                const mentionText = adm.type === 'user' ? `<@${adm.targetId}>` : `<@&${adm.targetId}>`;
                if (adm.targetId !== interaction.guild.ownerId) {
                    adminGroups[adm.level].push(mentionText);
                }
            });

            // Build dynamic fields matching the aesthetic from image_3275fc.jpg
            for (let i = 10; i >= 1; i--) {
                if (adminGroups[i].length > 0) {
                    const list = adminGroups[i].join('\n• ');
                    viewEmbed.addFields({
                        name: `⚙️ Admin Level ${i}`,
                        value: `**Permissions:** ${LEVEL_PERMISSIONS[i]}\n• ${list}`,
                        inline: false
                    });
                }
            }

            return interaction.editReply({ embeds: [viewEmbed] });
        }

        // --- /ticket config ---
        if (commandName === 'ticket' && options.getSubcommand() === 'config') {
            const category = options.getChannel('category');
            await GuildConfig.findOneAndUpdate(
                { guildId: interaction.guild.id },
                { ticketCategoryId: category.id },
                { upsert: true, new: true }
            );
            return interaction.reply({ content: `✅ Ticket category has been set to: **${category.name}**`, ephemeral: true });
        }

        // --- /verify ticket config ---
        if (commandName === 'verify' && options.getSubcommand() === 'config') {
            const category = options.getChannel('category');
            await GuildConfig.findOneAndUpdate(
                { guildId: interaction.guild.id },
                { verifyCategoryId: category.id },
                { upsert: true, new: true }
            );
            return interaction.reply({ content: `✅ Verification category has been set to: **${category.name}**`, ephemeral: true });
        }

        // --- /ticket panel ---
        if (commandName === 'ticket' && options.getSubcommand() === 'panel') {
            const reportEmbed = new EmbedBuilder()
                .setTitle(EMBED_CONFIG.reportPanelTitle)
                .setDescription(EMBED_CONFIG.reportPanelDescription)
                .setColor(EMBED_CONFIG.errorColor);

            const otherEmbed = new EmbedBuilder()
                .setTitle(EMBED_CONFIG.otherPanelTitle)
                .setDescription(EMBED_CONFIG.otherPanelDescription)
                .setColor(EMBED_CONFIG.errorColor);

            const reportRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('open_report_menu')
                    .setLabel('Create Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            const otherRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('open_other_menu')
                    .setLabel('Create Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.channel.send({ embeds: [reportEmbed], components: [reportRow] });
            await interaction.channel.send({ embeds: [otherEmbed], components: [otherRow] });
            return interaction.reply({ content: "Ticket panels deployed successfully.", ephemeral: true });
        }

        // --- /send panel ---
        if (commandName === 'send' && options.getSubcommand() === 'panel') {
            const verifyEmbed = new EmbedBuilder()
                .setTitle(EMBED_CONFIG.verificationTitle)
                .setDescription(EMBED_CONFIG.verificationDescription)
                .setFooter({ text: EMBED_CONFIG.footerText })
                .setColor(EMBED_CONFIG.primaryColor);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('verify_oauth')
                    .setLabel('Verify via ROBLOX Login')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('verify_game')
                    .setLabel('Verify via ROBLOX Game')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('update_roles')
                    .setLabel('Update Roles')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('verify_tickets')
                    .setLabel('Verify via TICKETS')
                    .setStyle(ButtonStyle.Primary)
            );

            await interaction.channel.send({ embeds: [verifyEmbed], components: [row] });
            return interaction.reply({ content: "Verification panel deployed successfully.", ephemeral: true });
        }
    }

    // ==========================================
    // BUTTON CLICK INTERACTION HANDLING
    // ==========================================
    if (interaction.isButton()) {
        if (interaction.customId === 'open_report_menu') {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('ticket_select_report')
                .setPlaceholder('Select Ticket Type')
                .addOptions([
                    { label: 'Report High Rank', description: 'Report a high ranking officer.', value: 'report_high_rank' },
                    { label: 'Report Exploiter', description: 'Report an exploiter to our moderation team.', value: 'report_exploiter' },
                    { label: 'Report Corruption', description: 'Report a corrupted user.', value: 'report_corruption' },
                    { label: 'Report Abuser', description: 'Report an abuser.', value: 'report_abuser' },
                    { label: 'Report Rule Breaker', description: 'Report a server rule breaker.', value: 'report_rule_breaker' }
                ]);
            const row = new ActionRowBuilder().addComponents(selectMenu);
            return interaction.reply({ content: 'Please select the type of ticket you wish to create.', components: [row], ephemeral: true });
        }

        if (interaction.customId === 'open_other_menu') {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('ticket_select_other')
                .setPlaceholder('Select Ticket Type')
                .addOptions([
                    { label: 'Report Bug / Glitch', description: 'Report a game or discord bug to developers.', value: 'report_bug' },
                    { label: 'Report Exploit Script', description: 'Report an exploit script or system vulnerability.', value: 'report_exploit_script' },
                    { label: 'Developer Application', description: 'Apply to become a developer.', value: 'developer_application' },
                    { label: 'Alliance Application', description: 'Apply to become an ally with us.', value: 'alliance_application' }
                ]);
            const row = new ActionRowBuilder().addComponents(selectMenu);
            return interaction.reply({ content: 'Please select the type of ticket you wish to create.', components: [row], ephemeral: true });
        }

        if (interaction.customId === 'verify_tickets') {
            const dbConfig = await GuildConfig.findOne({ guildId: interaction.guild.id });
            if (!dbConfig || !dbConfig.verifyCategoryId) {
                return interaction.reply({ content: "❌ Verification category has not been configured by an administrator yet.", ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const channelName = `verify-${interaction.user.username}`;
            const privateChannel = await interaction.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: dbConfig.verifyCategoryId,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                ],
            });

            const initEmbed = new EmbedBuilder()
                .setTitle("Roblox Verification")
                .setDescription(`Hello ${interaction.user},\n\nPlease type your Roblox Username below to start verification.\n\nType cancel at any time to close this channel.\n\nVerification System | Step 1 of 3`)
                .setColor(EMBED_CONFIG.primaryColor);

            await privateChannel.send({ content: `Hello ${interaction.user},`, embeds: [initEmbed] });
            await interaction.editReply({ content: `Verification channel created: ${privateChannel}` });

            const filter = (m) => m.author.id === interaction.user.id;
            const collector = privateChannel.createMessageCollector({ filter, time: 300000 });

            let step = 1;
            let robloxUsername = "";
            let robloxId = "";
            let verificationCode = generateVerificationCode();

            collector.on('collect', async (m) => {
                if (m.content.toLowerCase() === 'cancel') {
                    await privateChannel.send({ content: "Verification canceled. Deleting channel..." });
                    setTimeout(() => privateChannel.delete().catch(() => {}), 5000);
                    collector.stop();
                    return;
                }

                if (step === 1) {
                    robloxUsername = m.content;
                    try {
                        const response = await axios.post('https://users.roblox.com/v1/usernames/users', {
                            usernames: [robloxUsername],
                            excludeBannedUsers: false
                        });

                        if (!response.data.data || response.data.data.length === 0) {
                            await privateChannel.send({ content: "Username not found. Please type a valid Roblox username." });
                            return;
                        }

                        robloxId = response.data.data[0].id;
                        robloxUsername = response.data.data[0].name;

                        const confirmEmbed = new EmbedBuilder()
                            .setTitle("Is this your account?")
                            .setDescription(`Please confirm if this is your account.\nReply with YES or NO.\n\n**Username**\n${robloxUsername}\n\n**User ID**\n${robloxId}\n\n**Profile Link**\n[View Profile](https://www.roblox.com/users/${robloxId}/profile)\n\nVerification System | Step 2 of 3`)
                            .setColor(EMBED_CONFIG.primaryColor);

                        await privateChannel.send({ embeds: [confirmEmbed] });
                        step = 2;
                    } catch (error) {
                        await privateChannel.send({ content: "An error occurred while connecting to Roblox. Please try again." });
                    }
                } 
                else if (step === 2) {
                    if (m.content.toLowerCase() === 'yes') {
                        const codeEmbed = new EmbedBuilder()
                            .setTitle("Profile Verification")
                            .setDescription(`To verify ownership, please copy the code below and paste it into your Roblox profile **About** or **Description** section.\n\n**Code to Copy:**\n\`\`\`${verificationCode}\`\`\`\n\nOnce you have saved your profile, type **DONE** here.`)
                            .setColor(EMBED_CONFIG.primaryColor);

                        await privateChannel.send({ embeds: [codeEmbed] });
                        step = 3;
                    } else if (m.content.toLowerCase() === 'no') {
                        await privateChannel.send({ content: "Restarting. Please enter your correct Roblox username." });
                        step = 1;
                    } else {
                        await privateChannel.send({ content: "Invalid response. Please reply with YES or NO." });
                    }
                } 
                else if (step === 3) {
                    if (m.content.toLowerCase() === 'done') {
                        try {
                            const profileResponse = await axios.get(`https://users.roblox.com/v1/users/${robloxId}`);
                            const description = profileResponse.data.description || "";

                            if (description.includes(verificationCode)) {
                                const successEmbed = new EmbedBuilder()
                                    .setTitle("Verification Successful")
                                    .setDescription(`You have been verified as ${robloxUsername}.\n\nPrefix: [OR-1]\nNickname: [OR-1] ${robloxUsername}\n\nSuccess! Deleting this channel in 5 seconds...`)
                                    .setColor("#00ff00");

                                await privateChannel.send({ embeds: [successEmbed] });

                                const member = await interaction.guild.members.fetch(interaction.user.id);
                                const role = interaction.guild.roles.cache.get(CONFIG.VERIFIED_ROLE_ID);
                                if (role) await member.roles.add(role).catch(() => {});
                                await member.setNickname(`[OR-1] ${robloxUsername}`).catch(() => {});

                                setTimeout(() => privateChannel.delete().catch(() => {}), 5000);
                                collector.stop();
                            } else {
                                await privateChannel.send({ content: "❌ Code not found in your Roblox description. Make sure you saved it correctly and type **DONE** again." });
                            }
                        } catch (error) {
                            await privateChannel.send({ content: "Error verifying profile data. Please type **DONE** again." });
                        }
                    }
                }
            });
        }
    }

    // ==========================================
    // DROP-DOWN SELECT MENU HANDLING
    // ==========================================
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'ticket_select_report' || interaction.customId === 'ticket_select_other') {
            const dbConfig = await GuildConfig.findOne({ guildId: interaction.guild.id });
            if (!dbConfig || !dbConfig.ticketCategoryId) {
                return interaction.reply({ content: "❌ Support ticket category has not been configured by an administrator yet.", ephemeral: true });
            }

            const selectedValue = interaction.values[0];
            const channelName = `ticket-${interaction.user.username}`;
            
            const ticketChannel = await interaction.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: dbConfig.ticketCategoryId,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                ],
            });

            const cleanName = selectedValue.replace(/_/g, ' ').toUpperCase();
            const ticketEmbed = new EmbedBuilder()
                .setTitle("Ticket Created")
                .setDescription(`Hello ${interaction.user},\n\nThank you for reaching out. Support staff will be with you shortly regarding: **${cleanName}**`)
                .setColor(EMBED_CONFIG.errorColor);

            await ticketChannel.send({ content: `${interaction.user}`, embeds: [ticketEmbed] });
            await interaction.reply({ content: `✅ Ticket channel created successfully: ${ticketChannel}`, ephemeral: true });
        }
    }
});

client.login(CONFIG.TOKEN);