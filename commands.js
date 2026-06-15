const { SlashCommandBuilder, ChannelType } = require('discord.js');

module.exports = [
    new SlashCommandBuilder()
        .setName('set-cookie')
        .setDescription('Securely saves the .ROBLOSECURITY account session cookie.')
        .addStringOption(option => 
            option.setName('cookie')
                .setDescription('The string value of your .ROBLOSECURITY cookie.')
                .setRequired(true)),
                
    new SlashCommandBuilder()
        .setName('configure-group')
        .setDescription('Binds the server configuration to an active Roblox Group ID.')
        .addIntegerOption(option => 
            option.setName('group-id')
                .setDescription('The numerical ID sequence of your target Roblox group.')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('set-log-channel')
        .setDescription('Redirects automated status logging pipelines to specific channels.')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Select the tracking logs channel classification.')
                .setRequired(true)
                .addChoices(
                    { name: 'Verification Tracking Logs', value: 'verification' },
                    { name: 'Moderation System Logs', value: 'moderation' },
                    { name: 'Tickets Action Logs', value: 'tickets' }
                ))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Target destination text channel.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Advances a specified Roblox user up by 1 rank tier inside the group.')
        .addStringOption(option => 
            option.setName('username')
                .setDescription('Target Roblox username.')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('demote')
        .setDescription('Lowers a specified Roblox user down by 1 rank tier inside the group.')
        .addStringOption(option => 
            option.setName('username')
                .setDescription('Target Roblox username.')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('setrank')
        .setDescription('Updates a Roblox account to a precise numerical rank code (1-255).')
        .addStringOption(option => 
            option.setName('username')
                .setDescription('Target Roblox username.')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('rank-value')
                .setDescription('The numerical rank value (1-255).')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('send-panel')
        .setDescription('Deploys the verification panel framework to start user chains.'),

    new SlashCommandBuilder()
        .setName('update')
        .setDescription('Performs an evaluation sync sweep on your local rank bindings.'),

    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Master control structures for ticket deployment.')
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('Deploys the visual report and support drop-down panels.'))
        .addSubcommand(sub =>
            sub.setName('configure')
                .setDescription('Maps the dynamic category assignment for generated tickets.')
                .addChannelOption(opt =>
                    opt.setName('category')
                        .setDescription('Select the target layout category folder.')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(true)))
].map(command => command.toJSON());