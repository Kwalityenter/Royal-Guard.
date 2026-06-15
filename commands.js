// commands.js
module.exports = [
    {
        name: 'send-panel',
        description: 'Deploys the main V5 Roblox verification panel link structure.',
    },
    {
        name: 'ticket',
        description: 'Ticketing system administrative panel command root.',
        options: [
            {
                type: 1, 
                name: 'panel',
                description: 'Deploys the standalone Report and Support ticket creation panels.',
            },
            {
                type: 1, 
                name: 'configure',
                description: 'Binds the parent Category Channel ID for support tickets.',
                options: [
                    {
                        type: 7, 
                        name: 'category',
                        description: 'The target discord category channel.',
                        required: true
                    }
                ]
            }
        ]
    },
    {
        name: 'config',
        description: 'Global backend administration settings.',
        options: [
            {
                type: 1, 
                name: 'cookie',
                description: 'Securely configures the authorization .ROBLOSECURITY account cookie.',
                options: [
                    {
                        type: 3, 
                        name: 'value',
                        description: 'Paste your full raw Roblox cookie string.',
                        required: true
                    }
                ]
            }
        ]
    },
    {
        name: 'setrank',
        description: 'Directly alters a verified user\'s rank within your Roblox Group.',
        options: [
            {
                type: 6, 
                name: 'user',
                description: 'The target member inside the discord server.',
                required: true
            },
            {
                type: 4, 
                name: 'rankid',
                description: 'The target numeric Roblox Rank value (0-255).',
                required: true
            }
        ]
    },
    {
        name: 'promote',
        description: 'Shifts a verified user up exactly one rank tier in your Roblox Group.',
        options: [
            {
                type: 6, 
                name: 'user',
                description: 'The target member inside the discord server.',
                required: true
            }
        ]
    },
    {
        name: 'demote',
        description: 'Shifts a verified user down exactly one rank tier in your Roblox Group.',
        options: [
            {
                type: 6, 
                name: 'user',
                description: 'The target member inside the discord server.',
                required: true
            }
        ]
    },
    {
        name: 'security',
        description: 'Configures defensive server security automation modules.',
        options: [
            {
                type: 1, 
                name: 'anti-ping',
                description: 'Toggles and targets the global server mass mention limits.',
                options: [
                    {
                        type: 5, 
                        name: 'enabled',
                        description: 'Enable or disable anti-ping.',
                        required: true
                    },
                    {
                        type: 4, 
                        name: 'max-pings',
                        description: 'The maximum allowed unique mentions per message.',
                        required: false
                    }
                ]
            }
        ]
    },
    {
        name: 'admin',
        description: 'Manages programmatic administrator privileges.',
        options: [
            {
                type: 1, 
                name: 'view',
                description: 'Displays all users and roles with assigned system clearance.'
            },
            {
                type: 1, 
                name: 'add',
                description: 'Appoints custom clearance access over a target profile or role.',
                options: [
                    {
                        type: 4, 
                        name: 'level',
                        description: 'Clearance evaluation tier level to assign.',
                        required: true
                    },
                    {
                        type: 6, 
                        name: 'user',
                        description: 'Target user profile.',
                        required: false
                    },
                    {
                        type: 8, 
                        name: 'role',
                        description: 'Target server role.',
                        required: false
                    }
                ]
            }
        ]
    },
    {
        name: 'rankbinds',
        description: 'Maps numeric Roblox group values to server configurations.',
        options: [
            {
                type: 1, 
                name: 'view',
                description: 'Displays all configured Roblox rank-to-role bindings.'
            },
            {
                type: 1, 
                name: 'add',
                description: 'Creates a binding rule mapping a Roblox rank value to multiple Discord roles.',
                options: [
                    {
                        type: 4, 
                        name: 'groupid',
                        description: 'The internal numeric Roblox Group ID.',
                        required: true
                    },
                    {
                        type: 4, 
                        name: 'rankid',
                        description: 'Roblox rank value tracking indicator (0-255).',
                        required: true
                    },
                    {
                        type: 8, 
                        name: 'role',
                        description: 'The primary Discord role to grant.',
                        required: true
                    },
                    {
                        type: 8, 
                        name: 'role2',
                        description: 'A second Discord role to grant (Optional).',
                        required: false
                    },
                    {
                        type: 8, 
                        name: 'role3',
                        description: 'A third Discord role to grant (Optional).',
                        required: false
                    },
                    {
                        type: 3, 
                        name: 'prefix',
                        description: 'Custom bracketed prefix identifier to force append to nicknames.',
                        required: false
                    }
                ]
            }
        ]
    },
    {
        name: 'update',
        description: 'Manually triggers a full synchronization update on your own server roles.'
    }
];