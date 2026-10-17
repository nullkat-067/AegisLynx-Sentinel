# NULLKAT Organization Project

## WhatsApp Kick Bot

**AegisLynx Sentinel** is a flexible WhatsApp group-intro validator and age moderation bot created in Indonesia by **NullKat Development**.

> Made in Indonesia by NullKat Development.

## Project structure

```text
WhatsApp-Project/
├── index.js
├── Parse.js
├── package.json
├── package-lock.json
├── README.md
└── Information/
    ├── kick.json
    ├── owner.json
    ├── config.json
    ├── intro.json
    └── admin.json
```

## What the bot does

The bot reads group intros without requiring a fixed template. Decorative fonts, different separators, emojis, and different layouts are supported as long as the intro contains these required fields:

```text
nama:
umur:
username:
```

The parser also understands common aliases such as `name`, `usia`, `age`, `user name`, and `roblox username`. Additional fields such as gender, city, reason, and group-entry method are optional and are saved when available.

A valid intro with an age below the configured minimum is warned and removed when the bot is a group administrator. A valid intro at or above the minimum is saved to `Information/intro.json` and receives a welcome message.

## Installation

Use Node.js 20 or newer:

```bash
npm install
node index.js
```

On the first run, the bot asks for a WhatsApp phone number and prints a Pairing Code. The WhatsApp session is saved in `auth_info_baileys/`. Do not delete or share that folder unless you intentionally want to pair again.

## Runtime files

| File | Purpose |
|---|---|
| `Information/kick.json` | Stores underage kick records. |
| `Information/owner.json` | Stores owner phone numbers. |
| `Information/config.json` | Stores the minimum age. |
| `Information/intro.json` | Stores accepted intro records. |
| `Information/admin.json` | Stores authorized admin phone numbers. |

Use international phone-number format such as `628123456789` in `owner.json` and `admin.json`.

## Notes

The bot must be promoted to a group administrator before it can remove members. The parser is deterministic: it recognizes field labels and values, but it does not make subjective judgments about social context.

Do not publish WhatsApp sessions, private phone-number databases, passwords, or tokens to GitHub.

## Credits

- Developer: NullKat Development
- Project origin: Indonesia
- Bot name: AegisLynx Sentinel
