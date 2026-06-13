const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
    // --- VERIFICATION PANEL COMMAND ---
    new SlashCommandBuilder()
        .setName('send-panel')
        .setDescription('Deploys the main British Army V5 interactive verification portal panel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    // --- SECURITY SYSTEM COMMANDS ---
    new SlashCommandBuilder()
        .setName('security')
        .setDescription('Configure advanced guild guard settings.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('anti-ping')
                .setDescription('Toggle or tweak the instant-containment anti-ping threshold metrics.')
                .addBooleanOption(option => 
                    option.setName('enabled').setDescription('Set to true to activate anti-ping spam protocols.').setRequired(true))
                .addIntegerOption(option => 
                    option.setName('max-pings').setDescription('Maximum permitted pings in a single message before timeout actions occur.'))
        ),

    // --- ADMINISTRATION PROFILE HIERARCHIES ---
    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Modify internal bot permission levels.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View current authorization hierarchies.')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Grant bot clearance to a user or role mapping configuration.')
                .addIntegerOption(option => option.setName('level').setDescription('Clearance rank level.').setRequired(true))
                .addUserOption(option => option.setName('user').setDescription('Target user.'))
                .addRoleOption(option => option.setName('role').setDescription('Target role.')) // Fixed from .setRoleOption
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Revoke bot clearance parameters.')
                .addUserOption(option => option.setName('user').setDescription('Target user profile.'))
                .addRoleOption(option => option.setName('role').setDescription('Target role profile.')) // Fixed from .setRoleOption
        ),

    // --- ROBLOX RANK BINDINGS ---
    new SlashCommandBuilder()
        .setName('rankbinds')
        .setDescription('Manage your Roblox group database sync rules.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('Display current mappings.')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Map a Roblox rank number to a Discord role.')
                .addIntegerOption(option => option.setName('groupid').setDescription('Roblox group target ID.').setRequired(true))
                .addIntegerOption(option => option.setName('rankid').setDescription('Roblox rank ID number (1-255).').setRequired(true))
                .addRoleOption(option => option.setName('role').setDescription('Target Discord role.').setRequired(true)) // Fixed from .setRoleOption
                .addStringOption(option => option.setName('prefix').setDescription('Visual clan tag/rank tag (e.g. [OR-1]).'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Remove a Roblox rank binding rule.')
                .addIntegerOption(option => option.setName('rankid').setDescription('Roblox Rank ID to purge.').setRequired(true))
        ),

    // --- TICKET SYSTEM UTILITIES ---
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Interact with or adjust the support ticket engine framework.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('configure')
                .setDescription('Set the category container where tickets generate.')
                .addChannelOption(option => option.setName('category').setDescription('Category channel container.').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Manually permit a user account access to view an open ticket.')
                .addUserOption(option => option.setName('target').setDescription('Target user.').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('panel')
                .setDescription('Drop a standalone interactive support hub button element.')
                .addStringOption(option => option.setName('type').setDescription('The ticket variety handle label.').setRequired(true))
        ),

    // --- LOG ROUTING CHANNEL ---
    new SlashCommandBuilder()
        .setName('verification-logs')
        .setDescription('Assign the channel where server action logs flow.')
        .addChannelOption(option => option.setName('channel').setDescription('Target log text channel.').setRequired(true)),

    // --- CHAT MODERATION ENGINES ---
    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Log a direct caution infraction notice against an account.')
        .addUserOption(option => option.setName('user').setDescription('Target offender account.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Context metadata explanation.')),

    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Temporarily silence a user from interacting via structural text timeouts.')
        .addUserOption(option => option.setName('user').setDescription('Target user account.').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('E.g., 30m, 2h, 1d').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Context metadata explanation.')),

    new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Lift active communication restriction blocks early.')
        .addUserOption(option => option.setName('user').setDescription('Target user account.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Context metadata explanation.')),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Permanently evict a profile from the guild server tables.')
        .addUserOption(option => option.setName('user').setDescription('Target user account.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Context metadata explanation.')),

    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Forgive a target account ID ban entry.')
        .addStringOption(option => option.setName('userid').setDescription('Target raw string account format numerical ID.').setRequired(true)),

    // --- USER SYNCHRONIZATION DATA ROUTINES ---
    new SlashCommandBuilder()
        .setName('update')
        .setDescription('Manually trigger a role and profile alignment table scan.'),

    // --- CORE ROBLOX API SETUP CREDENTIALS ---
    new SlashCommandBuilder()
        .setName('roblox-cookie')
        .setDescription('Authenticates your internal group automated ranking profile session backend.')
        .addStringOption(option => option.setName('cookie').setDescription('.ROBLOX_SECURITY token contents.').setRequired(true))
        .addStringOption(option => option.setName('groupid').setDescription('Target structural group connection numerical ID.').setRequired(true)),

    // --- MANUAL GROUP PROMOTION UTILITIES ---
    new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Advance a user one step forward in your bound Roblox group.')
        .addStringOption(option => option.setName('username').setDescription('Target Roblox account username.').setRequired(true)),

    new SlashCommandBuilder()
        .setName('demote')
        .setDescription('Demote a user one step backward in your bound Roblox group.')
        .addStringOption(option => option.setName('username').setDescription('Target Roblox account username.').setRequired(true)),

    new SlashCommandBuilder()
        .setName('set-rank')
        .setDescription('Force shift an account directly to an explicit target rank hierarchy level.')
        .addStringOption(option => option.setName('username').setDescription('Target Roblox account username.').setRequired(true))
        .addIntegerOption(option => option.setName('rankid').setDescription('Target exact rank mapping ID layout (1-255).').setRequired(true))
].map(command => command.toJSON());

module.exports = commands;