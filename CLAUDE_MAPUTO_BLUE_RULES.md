
# CLAUDE.md — Maputo Blue Frontend Development Rules

## Always Do First
- Invoke the `frontend-design` skill before writing any frontend code, every session, no exceptions.

---

# Project Context

This project is the official website for **Maputo Blue**, a tourism agency based in Maputo, Mozambique.

The website promotes:
- Island day trips
- Beach day trips
- Safaris
- Transfers
- Maputo city tours
- Luxury accommodations

The site must be **professional, fast, SEO-friendly, and easy to maintain**.

The architecture must allow **travel packages and accommodations to be updated through JSON files instead of editing HTML manually**.

---

# Core Technology Stack

Use these technologies unless explicitly instructed otherwise:

- HTML5
- Bootstrap 5
- Vanilla JavaScript
- Custom CSS
- JSON for structured travel package data

Do NOT introduce frameworks such as:

- React
- Vue
- Angular
- Next.js

unless explicitly requested.

---

# Project Structure

Follow this structure strictly.

/pages
  index.html
  tours.html
  destinations.html
  accommodations.html
  package.html

/assets
  /css
  /js
  /images
  /icons

/data
  tours.json
  accommodations.json
  testimonials.json
  team.json

/components
  navbar.html
  footer.html

Do not create single-file HTML prototypes for this project.

---

# Data Driven Content System

All tours and accommodations must be stored in JSON.

Never hardcode packages directly in HTML.

Example:

/data/tours.json

Example object:

{
  "id": "xefina-sunset-cruise",
  "title": "Xefina Island Sunset Cruise",
  "location": "Maputo Bay",
  "duration": "3 hours",
  "group_size": "10 people",
  "price_from": 75,
  "currency": "USD",
  "rating": 4.8,
  "images": [
    "xefina1.jpg",
    "xefina2.jpg"
  ],
  "description": "Enjoy a sunset cruise around Xefina Island."
}

Pages must dynamically render this data using JavaScript.

---

# JavaScript Safety Rules

Never assume a DOM element exists.

Always guard selectors.

Example:

const element = document.querySelector('.example')
if (!element) return

Scripts must never crash if a component is missing.

Use modular patterns or IIFE blocks to avoid global variable pollution.

All sliders must support swipe on mobile.

---

# CSS Rules

Bootstrap must be used for layout and responsive grid.

Custom styling must go in:

/assets/css/main.css

Avoid inline styles.

Use clear component-based class names.

Good examples:

.tour-card
.accommodation-card
.gallery-item
.section-header

Avoid generic names such as:

.box
.item
.container2

---

# Layout Consistency

All sections must respect the global container layout:

max-width: 1200px
margin: 0 auto
padding: 0 24px

Spacing must remain consistent across sections.

Avoid full-width layouts unless explicitly requested.

---

# Design System

Font:
DM Sans

Icons:
Box Icons

Color palette:

Primary Ocean Blue  #0A2540
Deep Navy           #071B2E
Sea Green           #1EA896
Soft Sand           #F2E9E4
Light Background    #F8FAFC
Accent Coral        #F26419

Use these colors consistently across the interface.

---

# Reference Images

If a reference image is provided:

Match the layout exactly.

Do not:
- add new sections
- change spacing
- change typography
- modify design elements

Swap only placeholder content.

If no reference image exists, create a clean tourism-style layout consistent with the brand.

Perform at least **two comparison passes**.

---

# Local Server

Always serve on localhost — never screenshot a file:/// URL.

Start the dev server:

node serve.mjs

This serves the project at:

http://localhost:3000

Do not start a second server if one is already running.

---

# Screenshot Workflow

Always screenshot from localhost:

node screenshot.mjs http://localhost:3000

Screenshots are saved to:

./temporary screenshots/

After screenshotting check:

- spacing
- typography
- color values
- alignment
- border radius
- shadows
- image scaling

---

# Brand Assets

Always check the `brand_assets/` folder before designing.

If assets exist:

- logos must be used
- defined brand colors must be respected
- do not invent new colors

---

# Image Rules

Images must be stored in:

/assets/images/

Organize by category:

/images/tours/
/images/accommodations/
/images/team/
/images/destinations/

Never use spaces in filenames.

Correct:
machangulo-beach-lodge

Incorrect:
machangulo beach lodge

---

# Anti-Generic Guardrails

Colors must follow the defined palette.

Do not use generic Bootstrap defaults.

Shadows must use layered low-opacity shadows.

Animations:
- animate only transform and opacity
- never use transition-all

Every interactive element must include:
- hover state
- focus-visible state
- active state

---

# SEO Requirements

Each page must include:

- meta title
- meta description
- Open Graph tags
- semantic HTML structure

Heading hierarchy must be respected:

H1 → H2 → H3

---

# Hard Rules

Do not:

- introduce new frameworks
- rewrite working components unnecessarily
- break existing functionality
- hardcode travel packages in HTML
- assume DOM elements exist

Always prefer **incremental improvements and data-driven content**.
