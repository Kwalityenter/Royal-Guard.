const { SlashCommandBuilder, ChannelType } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('rankbinds')
        .setDescription('Manage the Roblox rank bindings for this server')
        .addSubcommand(sub =>
            sub.setName('add')
               .setDescription('Bind a Roblox rank to a specific nickname prefix and Discord role')
               .addIntegerOption(option => option.setName('groupid').setDescription('The ID of your Roblox group').setRequired(true))
               .addIntegerOption(option => option.setName('rankid').setDescription('The Roblox rank ID number from 1 to 255').setRequired(true))
               .addStringOption(option => option.setName('prefix').setDescription('The prefix to apply, for example: [OR-1]').setRequired(true))
               .addRoleOption(option => option.setName('role').setDescription('The Discord role to give users at this rank').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('delete')
               .setDescription('Remove an existing Roblox rank binding')
               .addIntegerOption(option => option.setName('rankid').setDescription('The Roblox rank ID you want to unbind').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('view')
               .setDescription('View all configured Roblox rank bindings for this server')
        ),
            
    new SlashCommandBuilder()
        .setName('update')
        .setDescription('Sync your nickname and roles with your current Roblox rank'),

    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Manage bot administrators and permission levels')
        .addSubcommand(sub => 
            sub.setName('add')
               .setDescription('Give admin permissions to a user or a specific role')
               .addIntegerOption(opt => opt.setName('level').setDescription('The clearance level from 1 to 7').setRequired(true).setMinValue(1).setMaxValue(7))
               .addUserOption(opt => opt.setName('user').setDescription('The user you want to add').setRequired(false))
               .addRoleOption(opt => opt.setName('role').setDescription('The role you want to add').setRequired(false)))
        .addSubcommand(sub => 
            sub.setName('delete')
               .setDescription('Remove admin permissions from a user or role')
               .addUserOption(opt => opt.setName('user').setDescription('The user to remove').setRequired(false))
               .addRoleOption(opt => opt.setName('role').setDescription('The role to remove').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('view')
               .setDescription('View all users and roles with assigned bot clearance levels')),

    new SlashCommandBuilder()
        .setName('verification-logs')
        .setDescription('Set the text channel where system logs will be sent')
        .addChannelOption(opt => 
            opt.setName('channel')
               .setDescription('Select the target text channel')
               .setRequired(true)
               .addChannelTypes(ChannelType.GuildText)),

    new SlashCommandBuilder()
        .setName('security')
        .setDescription('Configure protection and security sub-modules')
        .addSubcommand(sub =>
            sub.setName('anti-raid')
               .setDescription('Toggle or configure join rate limits to block bot attacks (Requires Level 6 Admin)')
               .addBooleanOption(opt => opt.setName('enabled').setDescription('Enable or disable anti-raid').setRequired(true))
               .addIntegerOption(opt => opt.setName('threshold').setDescription('Maximum allowed joins within a 10 second window').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('anti-nuke')
               .setDescription('Configure protection against malicious or compromised admins (Requires Level 6 Admin)')
               .addBooleanOption(opt => opt.setName('enabled').setDescription('Enable or disable anti-nuke').setRequired(true))
               .addIntegerOption(opt => opt.setName('max-deletions').setDescription('Maximum channel deletions allowed per minute').setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('anti-ping')
               .setDescription('Configure limits on mentions to prevent spam (Requires Level 7 Admin)')
               .addBooleanOption(opt => opt.setName('enabled').setDescription('Enable or disable anti-ping protections').setRequired(true))
               .addIntegerOption(opt => opt.setName('max-pings').setDescription('Maximum mentions allowed inside a single message').setRequired(false))),

    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Issue a formal warning to a member')
        .addUserOption(opt => opt.setName('user').setDescription('The user you want to warn').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('The reason for issuing this warning').setRequired(true)),

    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Temporarily mute or timeout a member')
        .addUserOption(opt => opt.setName('user').setDescription('The user you want to mute').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('The duration of the mute, for example: 30m, 3h, 1d').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('The reason for muting this user').setRequired(true)),

    new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove a timeout or mute from a member')
        .addUserOption(opt => opt.setName('user').setDescription('The user you want to unmute').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('The reason for unmuting this user').setRequired(false)),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Permanently ban a member from the server')
        .addUserOption(opt => opt.setName('user').setDescription('The user you want to ban').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('The reason for the ban').setRequired(true)),

    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user from the server using their account ID')
        .addStringOption(opt => opt.setName('userid').setDescription('The Discord User ID to unban').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('The reason for lifting the ban').setRequired(false)),

    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Manage the support ticket system')
        .addSubcommand(sub =>
            sub.setName('configure')
               .setDescription('Set the category folder where new ticket channels will open')
               .addChannelOption(opt => opt.setName('category').setDescription('The target category').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('add')
               .setDescription('Add a member to an active ticket channel')
               .addUserOption(opt => opt.setName('target').setDescription('The user to add').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('panel')
               .setDescription('Send a clickable ticket creation embed panel')
               .addStringOption(opt => 
                    opt.setName('type')
                       .setDescription('Select the type of ticket panel to deploy')
                       .setRequired(true)
                       .addChoices(
                           { name: 'Report Tickets Panel', value: 'report' },
                           { name: 'Other Tickets Panel', value: 'other' }
                       ))
        ),

    new SlashCommandBuilder()
        .setName('roblox-cookie')
        .setDescription('Set up the Roblox group session cookie (Requires Level 5 Admin)')
        .addStringOption(opt => opt.setName('cookie').setDescription('Your .ROBLOX_SECURITY cookie key').setRequired(true))
        .addStringOption(opt => opt.setName('groupid').setDescription('Your target Roblox Group ID').setRequired(true)),

    new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Promote a user by one rank in the connected Roblox group')
        .addStringOption(opt => opt.setName('username').setDescription('Their Roblox username').setRequired(true)),

    new SlashCommandBuilder()
        .setName('demote')
        .setDescription('Demote a user by one rank in the connected Roblox group')
        .addStringOption(opt => opt.setName('username').setDescription('Their Roblox username').setRequired(true)),

    new SlashCommandBuilder()
        .setName('set-rank')
        .setDescription('Move a user directly to a specific rank number in the Roblox group')
        .addStringOption(opt => opt.setName('username').setDescription('Their Roblox username').setRequired(true))
        .addIntegerOption(opt => opt.setName('rankid').setDescription('The target rank number from 1 to 255').setRequired(true))
].map(command => command.toJSON());

module.exports = commands;