# Counterstake Governance Discord bot

Watch the [Obyte counterstake governance AAs](https://counterstake.org) and posts notifications on Discord when something happens.

## Setup

- `yarn`
- Run with `node start.js`, it will create an app data directory named after the package (`~/Library/Application Support/counterstake-governance-discord` on macOS, `%APPDATA%` on Windows, `~/.config` on Linux) then fail due to configuration missing
- While logged on Discord webapp, create an application at https://discord.com/developers/applications
- Select the application, select bot in menu, copy the bot token
- Copy `.env.sample` file to `.env` and complete it with the bot token and the channel id the bot will post to
- While logged on Discord, use the following url template to add the bot to your server: https://discord.com/oauth2/authorize?client_id=881946977754038272&scope=bot&permissions=2048, `client_id` can be found in the General Information of your Discord application (Application ID), permissions should be `2048` to allow only posting message.
- Run the bot with `node start.js`

## Alerts for unsafe leader values

The bot also checks the current *leader* of every governance parameter, on Obyte AAs and on EVM
VotedValue contracts of all versions. If a leader is uncommitted, half of its challenging period has
passed, and the value would be rejected by the new Counterstake contracts/AAs, a red **Alert** embed
is posted and repeated on every check until the leader changes or gets committed.

Limits: `ratio` 0.1..10, `counterstake_coef` (1, 10], challenging periods >= 12 hours, `min_tx_age`
< 4 weeks. On top of them the bot requires `oracleAddress` and `oracles` to point at the trusted
oracle listed in `conf.js`, which is empty on testnet.

- `alert_check_interval_hours` in `conf.js` sets how often each chain is swept: Obyte every 6 hours, EVM every 24.
- A leader found unsafe in the first half of its period is only logged, with the address, parameter, value and remaining time. The alert follows on a later pass.
- Monitors log through `console.error`, so their output stays on the terminal while the rest goes to `log.txt`. Every pass ends with a summary line.
