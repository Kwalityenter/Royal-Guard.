const { SlashCommandBuilder, ChannelType } = require('discord.js');

const commands = [
    // 1. Add License (Bot Owner Only)
    new SlashCommandBuilder()
        .setName('add-license')
        .setDescription('Authorize a new Discord server instance to use this bot (Owner Only).')
        .addStringOption(option =>
            option.setName('server-id')
                .setDescription('The numeric ID of the target Discord server.')
                .setRequired(true)
        ),

    // 2. Activity Check
    new SlashCommandBuilder()
        .setName('activitycheck')
        .setDescription('Deploys an interactive, trackable Activity Check embed panel into this channel.'),

    // 3. Set Roblox Cookie (Bot Owner Only)
    new SlashCommandBuilder()
        .setName('set-cookie')
        .setDescription('Configure the .ROBLOSECURITY authentication cookie (Owner Only).')
        .addStringOption(option =>
            option.setName('cookie')
                .setDescription('The raw Roblox account security cookie.')
                .setRequired(true)
        ),

    // 4. Configure Roblox Group
    new SlashCommandBuilder()
        .setName('configure-group')
        .setDescription('Link your primary Roblox Group ID to this server.')
        .addIntegerOption(option =>
            option.setName('group-id')
                .setDescription('The numeric ID of your Roblox Group.')
                .setRequired(true)
        ),

    // 5. Set Log Channels
    new SlashCommandBuilder()
        .setName('set-log-channel')
        .setDescription('Redirect specific bot log feeds to a designated text channel.')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('The system log stream configuration category.')
                .setRequired(true)
                .addChoices(
                    { name: 'Moderation Logs', value: 'moderation' },
                    { name: 'Ticket Audits', value: 'tickets' },
                    { name: 'Verification Logs', value: 'verification' }
                )
        )
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The target text channel.')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
        ),

    // 6. Manage Group Rank Binds
    new SlashCommandBuilder()
        .setName('bind')
        .setDescription('Manage automated Roblox-to-Discord rank-to-role binding parameters.')
        .addSubcommand(subcommand =>
            subcommand.setName('add')
                .setDescription('Bind a single targeted Roblox rank to one or more Discord roles.')
                .addStringOption(option =>
                    option.setName('roles')
                        .setDescription('Mention or paste IDs of roles to assign (e.g. @Role1 @Role2).')
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('rank-value')
                        .setDescription('The exact Roblox rank numeric tier index value (1-255).')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('comparison')
                        .setDescription('The mathematical comparison operator evaluation logic rule.')
                        .addChoices(
                            { name: 'Equals (==)', value: '==' },
                            { name: 'Greater Than or Equal (>=)', value: '>=' },
                            { name: 'Less Than or Equal (<=)', value: '<=' },
                            { name: 'Strictly Greater Than (>)', value: '>' },
                            { name: 'Strictly Less Than (<)', value: '<' }
                        )
                )
                .addStringOption(option =>
                    option.setName('prefix')
                        .setDescription('An optional organizational nickname hierarchy prefix bracket (e.g. WO1).')
                )
        )
        .addSubcommand(subcommand =>
            subcommand.setName('range')
                .setDescription('Bind an inclusive multi-rank Roblox block value span to target roles.')
                .addStringOption(option =>
                    option.setName('roles')
                        .setDescription('Mention or paste IDs of roles to assign (e.g. @Role1 @Role2).')
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('min-rank')
                        .setDescription('The lowest numeric boundary value of this group tier selection range.')
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('max-rank')
                        .setDescription('The highest numeric boundary value of this group tier selection range.')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('prefix')
                        .setDescription('An optional organizational nickname hierarchy prefix bracket.')
                )
        )
        .addSubcommand(subcommand =>
            subcommand.setName('list')
                .setDescription('Display an overview list of all currently established rank binding parameters.')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('clear')
                .setDescription('Instantly erase all bound role rules and reset structural memory.')
        ),

    // 7. Promote Roblox User
    new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Promote a specified Roblox user up by exactly one rank tier increment.')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The exact Roblox account username profile signature handle.')
                .setRequired(true)
        ),

    // 8. Demote Roblox User
    new SlashCommandBuilder()
        .setName('demote')
        .setDescription('Demote a specified Roblox user down by exactly one rank tier decrement.')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The exact Roblox account username profile signature handle.')
                .setRequired(true)
        ),

    // 9. Setrank Roblox User
    new SlashCommandBuilder()
        .setName('setrank')
        .setDescription('Manually force change a Roblox member directly to an explicit target rank.')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The exact Roblox account username profile signature handle.')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('rank-value')
                .setDescription('The target destination numeric tier rank group index value (1-255).')
                .setRequired(true)
        ),

    // 10. Send Panel (Support Tickets)
    new SlashCommandBuilder()
        .setName('send-panel')
        .setDescription('Post the interactive Report and General inquiries support ticket creation panels.'),

    // 11. Ticket Management Utilities
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Admin support ticket engine administrative controls.')
        .addSubcommand(subcommand =>
            subcommand.setName('configure')
                .setDescription('Set the category container folder where active ticket panels are constructed.')
                .addChannelOption(option =>
                    option.setName('category')
                        .setDescription('Select the target Discord Category.')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildCategory)
                )
        ),

    // 12. BMT Panel Deployment
    new SlashCommandBuilder()
        .setName('bmt')
        .setDescription('Deploy the automated Basic Military Training evaluation assessment portal entry panel.'),

    // 13. Synchronize / Update Roles
    new SlashCommandBuilder()
        .setName('update')
        .setDescription('Manually prompt a data fetch update sync of your linked Roblox rank configurations.')
];

// Map and convert array builders automatically into deployment-ready JSON formats
module.exports = commands.map(command => command.toJSON());