module.exports = [
    {
        name: 'set-cookie',
        description: 'Set the Roblox .ROBLOSECURITY cookie (Server Owner Only)',
        options: [
            {
                type: 3, // STRING
                name: 'cookie',
                description: 'Your Roblox account cookie',
                required: true
            }
        ]
    },
    {
        name: 'configure-group',
        description: 'Link a Roblox group ID to this server',
        options: [
            {
                type: 4, // INTEGER
                name: 'group-id',
                description: 'The target Roblox Group ID',
                required: true
            }
        ]
    },
    {
        name: 'set-log-channel',
        description: 'Configure logging channels for specific systems',
        options: [
            {
                type: 3, // STRING
                name: 'type',
                description: 'The type of logs to send to this channel',
                required: true,
                choices: [
                    { name: 'Tickets', value: 'tickets' },
                    { name: 'Verification', value: 'verification' },
                    { name: 'Moderation', value: 'moderation' }
                ]
            },
            {
                type: 7, // CHANNEL
                name: 'channel',
                description: 'The target text channel for logs',
                required: true
            }
        ]
    },
    {
        name: 'bind',
        description: 'Manage RoWifi-style group rank binds',
        options: [
            {
                type: 1, // SUB_COMMAND
                name: 'add',
                description: 'Bind a specific rank condition to a Discord role',
                options: [
                    { 
                        type: 8, 
                        name: 'role', 
                        description: 'The Discord role to assign', 
                        required: true 
                    },
                    { 
                        type: 4, 
                        name: 'rank-value', 
                        description: 'The Roblox rank number (0-255)', 
                        required: true 
                    },
                    {
                        type: 3,
                        name: 'comparison',
                        description: 'How to evaluate the rank constraint',
                        required: false,
                        choices: [
                            { name: 'Equal To (==)', value: '==' },
                            { name: 'Greater Than or Equal To (>=)', value: '>=' },
                            { name: 'Less Than or Equal To (<=)', value: '<=' },
                            { name: 'Greater Than (>)', value: '>' },
                            { name: 'Less Than (<)', value: '<' }
                        ]
                    },
                    { 
                        type: 3, 
                        name: 'prefix', 
                        description: 'Optional group text prefix tag (e.g., Cpl)', 
                        required: false 
                    }
                ]
            },
            {
                type: 1, // SUB_COMMAND
                name: 'range',
                description: 'Bind a range of ranks to a role',
                options: [
                    { 
                        type: 8, 
                        name: 'role', 
                        description: 'The Discord role to assign', 
                        required: true 
                    },
                    { 
                        type: 4, 
                        name: 'min-rank', 
                        description: 'Minimum group rank threshold boundary', 
                        required: true 
                    },
                    { 
                        type: 4, 
                        name: 'max-rank', 
                        description: 'Maximum group rank threshold boundary', 
                        required: true 
                    },
                    { 
                        type: 3, 
                        name: 'prefix', 
                        description: 'Optional group text prefix tag', 
                        required: false 
                    }
                ]
            },
            {
                type: 1, // SUB_COMMAND
                name: 'list',
                description: 'List all active rank binds setup in this server'
            },
            {
                type: 1, // SUB_COMMAND
                name: 'clear',
                description: 'Remove all rank binds from the configuration'
            }
        ]
    },
    {
        name: 'promote',
        description: 'Promote a Roblox user by 1 rank',
        options: [
            {
                type: 3, // STRING
                name: 'username',
                description: 'The Roblox username to promote',
                required: true
            }
        ]
    },
    {
        name: 'demote',
        description: 'Demote a Roblox user by 1 rank',
        options: [
            {
                type: 3, // STRING
                name: 'username',
                description: 'The Roblox username to demote',
                required: true
            }
        ]
    },
    {
        name: 'setrank',
        description: 'Set a Roblox user to a specific rank',
        options: [
            {
                type: 3, // STRING
                name: 'username',
                description: 'The Roblox username',
                required: true
            },
            {
                type: 4, // INTEGER
                name: 'rank-value',
                description: 'The rank number to set (1-255)',
                required: true
            }
        ]
    },
    {
        name: 'send-panel',
        description: 'Send the main verification button panel to the current channel'
    },
    {
        name: 'ticket',
        description: 'Manage the support ticket system',
        options: [
            {
                type: 1, // SUB_COMMAND
                name: 'panel',
                description: 'Send the ticket creation dropdown panels'
            },
            {
                type: 1, // SUB_COMMAND
                name: 'configure',
                description: 'Configure the ticket category channel',
                options: [
                    {
                        type: 7, // CHANNEL
                        name: 'category',
                        description: 'The category channel where tickets will open',
                        required: true
                    }
                ]
            }
        ]
    },
    {
        name: 'update',
        description: 'Update your own roles based on your Roblox group status'
    }
];