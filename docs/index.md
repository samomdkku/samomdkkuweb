---
layout: home
hero:
  name: SAMO MDKKU
  text: How the site is built and changed
  tagline: The student portal for the Faculty of Medicine, Khon Kaen University. You do not need to be a programmer to change something here — start at the beginning and every step is written out.
  actions:
    - theme: brand
      text: Get started
      link: /start/prerequisites
    - theme: alt
      text: What you can change
      link: /contributing
features:
  - title: Run it locally
    details: What to install, how to get the project, and how to open it at localhost:5174. About ten minutes.
    link: /start/install
  - title: Your first change
    details: Branch, edit, commit, open a pull request, and see it live on a preview site. Command by command, with diagrams.
    link: /start/first-change
  - title: Department tools
    details: A ฝ่าย can ship its own tool page using the same process as the dev team, without waiting for IT to write it.
    link: /DEPT-TOOLS
  - title: How the system works
    details: Architecture, the database, access rules, and the invariants that must still hold next year.
    link: /CONTEXT
---

## Where to start

| You are | Start at |
|---|---|
| Fixing a typo, and you have never written code | [What you can change](/contributing) — you can edit it on GitHub, with nothing installed |
| Wanting to run the site on your own machine | [Prerequisites](/start/prerequisites) |
| In a ฝ่าย and want your own tool page | [Department tools](/DEPT-TOOLS) |
| Giving someone else access, or replacing a key | [Giving someone the credentials](/start/sharing-credentials) |
| Maintaining the system, or taking it over | [How the system works](/CONTEXT), then [Invariants](/INVARIANTS) |

## About this site

This is the `docs/` folder of the project, rendered as a website. To change a page, edit the file in that folder and open a pull request like any other change.

**Maintainer & agent notes** and the sections below it are working notes for maintainers and for the AI tools that help develop this project. They are records, not guides — skip them if you are here to contribute.

::: warning Current status is not here
What is in progress, what is blocked, what is broken — that lives in `STATE.md` at the top of the repository. It is kept separate on purpose, because it changes almost daily and a copy here would be stale immediately.
:::
