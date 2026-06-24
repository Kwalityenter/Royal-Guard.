const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const User = require('../models/User');

const bgCheckCooldowns = new Map();
const COOLDOWN_TIME = 10000;

module.exports = {
    name: 'bgcheck',
    description: 'Performs a customized cloud-synced background check.',
    async execute(message, args) {
        const branding = message.client.branding;
        const targetUser = message.mentions.users.first() || message.author;
        const targetMember = message.guild.members.cache.get(targetUser.id);

        if (bgCheckCooldowns.has(message.author.id) && Date.now() < bgCheckCooldowns.get(message.author.id)) {
            const cooldownEmbed = new EmbedBuilder()
                .setColor(branding.colors.error)
                .setTitle('Warning - Cooldown')
                .setDescription('You are currently on a cooldown for the `!bgcheck` command!');
            return message.reply({ embeds: [cooldownEmbed] });
        }

        bgCheckCooldowns.set(message.author.id, Date.now() + COOLDOWN_TIME);
        setTimeout(() => bgCheckCooldowns.delete(message.author.id), COOLDOWN_TIME);

        const loadingEmbed = new EmbedBuilder()
            .setColor(branding.colors.info)
            .setTitle(branding.titles.bgCheck)
            .setDescription('Please hold on whilst we background check the user.');

        const loadingMessage = await message.reply({ embeds: [loadingEmbed] });
        let dbUser = await User.findOne({ discordId: targetUser.id }) || await User.create({ discordId: targetUser.id, robloxUsername: targetUser.username });

        const joinedDate = targetMember ? targetMember.joinedAt.toUTCString() : "Not in Server";
        const registeredDate = targetUser.createdAt.toUTCString();
        const isNewAccount = (Date.now() - targetUser.createdTimestamp) < 7 * 24 * 60 * 60 * 1000;
        
        let alertText = isNewAccount ? '* [This user is new to our discord server.]' : '* [No immediate risks flagged.]';
        if (dbUser.isBlacklisted) alertText += '\n* [CRITICAL: User is marked as blacklisted in database!]';

        const rolesList = targetMember ? targetMember.roles.cache.filter(r => r.id !== message.guild.id).map(r => `<@&${r.id}>`).join('\n') || 'None' : 'None';

        const page1Embed = new EmbedBuilder()
            .setColor(branding.colors.primary)
            .setAuthor({ name: `${targetUser.tag} | [${targetMember?.roles.highest.name || 'User'}]`, iconURL: targetUser.displayAvatarURL() })
            .setTitle('User Discord Account Details')
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: 'Joined Date', value: `${joinedDate}`, inline: true },
                { name: 'Registered Date', value: `${registeredDate}`, inline: true },
                { name: `User Roles [${targetMember?.roles.cache.size - 1 || 0}]`, value: `${rolesList}` },
                { name: 'Alerts', value: `\`\`\`md\n${alertText}\n\`\`\`` }
            )
            .setFooter({ text: 'Viewing Page 1/2' });

        const page2Embed = new EmbedBuilder()
            .setColor(branding.colors.primary)
            .setAuthor({ name: `${dbUser.robloxUsername}`, iconURL: targetUser.displayAvatarURL() })
            .setTitle('User ROBLOX Account Details')
            .addFields(
                { name: 'ROBLOX Account Age', value: `${dbUser.robloxAgeDays} days`, inline: false },
                { name: 'ROBLOX Account Description', value: `${dbUser.robloxDescription}`, inline: false },
                { name: 'ROBLOX Account Groups', value: `${dbUser.robloxGroupsCount}`, inline: true },
                { name: 'ROBLOX Account Friends', value: `${dbUser.robloxFriendsCount}`, inline: true },
                { name: 'ROBLOX Account Followers', value: `${dbUser.robloxFollowersCount}`, inline: true },
                { name: 'ROBLOX Account Following', value: `${dbUser.robloxFollowingCount}`, inline: true },
                { name: 'Alerts', value: `\`\`\`md\n${alertText}\n\`\`\`` }
            )
            .setFooter({ text: 'Viewing Page 2/2' });

        const pages = [page1Embed, page2Embed];
        let currentPage = 0;

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('prev_page').setLabel('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId('next_page').setLabel('➡️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('delete_embed').setLabel('🗑️').setStyle(ButtonStyle.Danger)
        );

        await loadingMessage.edit({ embeds: [pages[currentPage]], components: [buttons] });

        const collector = loadingMessage.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, componentType: ComponentType.Button, time: 60000 });

        collector.on('collect', async interaction => {
            if (interaction.customId === 'prev_page') currentPage--;
            else if (interaction.customId === 'next_page') currentPage++;
            else if (interaction.customId === 'delete_embed') {
                await interaction.deferUpdate();
                return await loadingMessage.delete();
            }

            buttons.components[0].setDisabled(currentPage === 0);
            buttons.components[1].setDisabled(currentPage === pages.length - 1);
            await interaction.update({ embeds: [pages[currentPage]], components: [buttons] });
        });
    }
};