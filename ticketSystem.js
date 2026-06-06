const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    ChannelType,
    PermissionsBitField
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');
const cooldowns = new Map(); // Tracks user click cooldowns (18s)

// Helper functions to read/write persistent state
function getGuildConfig(guildId) {
    if (!fs.existsSync(DB_PATH)) return {};
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8') || '{}');
    return data[guildId] || {};
}

function updateGuildConfig(guildId, key, value) {
    const data = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH, 'utf8') || '{}') : {};
    if (!data[guildId]) data[guildId] = {};
    data[guildId][key] = value;
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 4));
}

// ==========================================
// 1. SLASH COMMAND DEFINITION
// ==========================================
const ticketCommand = new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage and configure the Royal Guard ticket environment.')
    .addSubcommand(sub =>
        sub.setName('configure')
           .setDescription('Configure ticket parameters for this guild.')
           .addChannelOption(opt => opt.setName('category').setDescription('The category category where tickets are created.').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
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
    );

// ==========================================
// 2. COMMAND EXECUTION INTERACTION HANDLER
// ==========================================
async function handleTicketCommands(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const configData = getGuildConfig(interaction.guildId);

    // Subcommand: Configure
    if (subcommand === 'configure') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: '❌ You do not possess structural administrative rights to alter configs.', ephemeral: true });
        }
        const category = interaction.options.getChannel('category');
        updateGuildConfig(interaction.guildId, 'ticketCategory', category.id);
        return interaction.reply({ content: `✅ Ticket creation category successfully bound to: **${category.name}**`, ephemeral: true });
    }

    // Subcommand: Add User to Ticket
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

    // Subcommand: Panel Send
    if (subcommand === 'panel') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: '❌ You lack permission parameters to deployment panel frameworks.', ephemeral: true });
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

// ==========================================
// 3. COMPONENT HANDLER (BUTTONS & DROPDOWNS)
// ==========================================
async function handleTicketComponents(interaction) {
    const { customId, user, guild } = interaction;

    // Cooldown verification handler
    if (customId.startsWith('ticket_btn_')) {
        const cooldownKey = `${user.id}-${guild.id}`;
        if (cooldowns.has(cooldownKey)) {
            const remaining = Math.ceil((cooldowns.get(cooldownKey) - Date.now()) / 1000);
            if (remaining > 0) {
                const cooldownEmbed = new EmbedBuilder()
                    .setTitle('Warning - Cooldown')
                    .setDescription(`You're currently on a **${remaining}s** cooldown for the **Create Ticket** button!`)
                    .setColor(0x2B2D31); // Dark charcoal branding
                return interaction.reply({ embeds: [cooldownEmbed], ephemeral: true });
            }
        }
        // Set an explicit 18-second cooldown matching the video sequence
        cooldowns.set(cooldownKey, Date.now() + 18000);
        setTimeout(() => cooldowns.delete(cooldownKey), 18000);
    }

    // Process "Report Tickets" Initial Trigger Click
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

    // Process "Other Tickets" Initial Trigger Click
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

    // Process Dropdown Option Select to build Channel Instance
    if (customId === 'ticket_select_creation') {
        await interaction.deferReply({ ephemeral: true });
        const choice = interaction.values[0];
        const configData = getGuildConfig(guild.id);
        
        const parentCategory = configData.ticketCategory ? guild.channels.cache.get(configData.ticketCategory) : null;
        let ticketNum = (configData.ticketCount || 0) + 1;
        updateGuildConfig(guild.id, 'ticketCount', ticketNum);

        // Normalize option values to human-readable labels
        const labelMap = {
            'rep_hr': 'high-rank', 'rep_exploit': 'exploiter', 'rep_corrupt': 'corruption', 'rep_abuse': 'abuser', 'rep_rules': 'rule-breaker',
            'oth_bug': 'bug-glitch', 'oth_script': 'exploit-script', 'oth_dev': 'developer-app', 'oth_alliance': 'alliance-app'
        };
        const ticketName = `ticket-${labelMap[choice] || 'general'}-${String(ticketNum).padStart(4, '0')}`;

        // Build target override mapping for confidentiality security parameters
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

module.exports = { ticketCommand, handleTicketCommands, handleTicketComponents };