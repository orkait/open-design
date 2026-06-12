---
name: guizang-social-card
zh_name: "归藏社交图文卡"
en_name: "Guizang Social Card"
description: "Create Guizang-style social card packages for Xiaohongshu/Rednote carousels and WeChat cover pairs."
zh_description: "为小红书/Rednote 图文组图和公众号封面对创建归藏风格社交图文卡。"
category: image
scenario: marketing
tags: ["social-card", "xiaohongshu", "rednote", "wechat-cover", "carousel", "editorial", "swiss"]
od:
  mode: image
  surface: web
  scenario: marketing
  upstream: "https://github.com/op7418/guizang-social-card-skill"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  example_prompt: "Use the Guizang Social Card workflow to turn my source content into a Xiaohongshu/Rednote carousel or WeChat cover pair."
  example_prompt_i18n:
    zh-CN: "使用「归藏社交图文卡」工作流，把我的素材做成小红书/Rednote 图文组图或公众号封面对。"
---

# Guizang Social Card

Use this plugin when the user asks for Xiaohongshu/Rednote carousel images, social cards, article thumbnails, WeChat official account cover pairs, or magazine/Swiss style static social graphics.

This is an Open Design wrapper for the upstream skill:
https://github.com/op7418/guizang-social-card-skill

Do not copy or edit the upstream Guizang PPT skill. Keep all generated work in the current project folder unless the user asks for a specific output path.

## Output

- Xiaohongshu/Rednote package: a cover plus content pages, usually 5-9 pages, sized for 3:4 social cards.
- WeChat package: a paired 21:9 main cover and 1:1 square share cover, composed together so the relationship can be inspected.
- Review artifact: single-file HTML first, then PNG exports after the user accepts the direction.

## Intake

Gather only missing details that change the output:

- Target platform: Xiaohongshu/Rednote carousel, WeChat cover pair, or generic social card.
- Source content: article, notes, subtitles, product update, screenshots, photos, or pasted copy.
- Supplied images/screenshots and where they should appear.
- Style preference if any: Editorial magazine, Swiss international, tech, lifestyle, outdoor, data/report, etc.
- Hard constraints: exact title, forbidden words, logo use, no image on square cover, screenshot readability, attribution needs.

If the user provides text but no images, ask once whether to use their own images, web-sourced images, or generated images. Accept their choice and proceed.

## Style Modes

Pick one mode per package.

Editorial magazine:

- Serif/Songti display plus quiet sans body.
- Paper, ink, grain, photo wells, marginalia, pull quotes, and slow editorial pacing.
- Best for narrative, lifestyle, travel, reading, film, essays, and considered observation.

Swiss international:

- Strict left-aligned grid, hairline rules, mono labels, light large display type, and one high-saturation accent.
- Best for product reviews, data, methods, tutorials, release notes, AI tools, and structured comparison.

Do not mix the two systems unless the user explicitly asks for a hybrid.

## Page Planning

Before coding, make an internal page plan:

```text
Page 01 / cover / hook / image source / layout intent
Page 02 / point / key copy / visual evidence / layout intent
...
```

Each page must carry one visual argument. Remove detail that belongs in the post body instead of the image.

## Build Rules

- Produce a single-file HTML artifact for review.
- Use CSS Grid and exact fixed poster dimensions.
- For Rednote cards, default to 1080x1440.
- For WeChat covers, include both 2100x900 and 1080x1080 in the same artifact.
- Keep text readable at thumbnail size.
- Do not use lorem ipsum or placeholder content.
- Do not place visible instructions, shortcuts, or usage text inside the images.
- Do not use decorative blobs, generic SaaS nested cards, or meaningless sticker shapes.
- Never blindly crop 21:9 into 1:1; compose the square cover separately.

## Image Handling

- User images and screenshots come first.
- Preserve screenshot content unless the user asks for redesign.
- Text over photos needs subject mapping, safe zones, and a thumbnail legibility check.
- If web images are used, save source URLs in `assets/SOURCES.md` and disclose them before finalizing.

## Delivery

Show the HTML or rendered PNGs first, then ask whether to run an automatic validation pass. If validation is requested, check overflow, footer collisions, tiny text, under-filled cards, and image crop problems before final delivery.
