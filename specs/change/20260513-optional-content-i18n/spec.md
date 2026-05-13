---
id: 20260513-optional-content-i18n
name: Optional Content I18n
status: researched
created: '2026-05-13'
---

## Overview

### Problem Statement

- `apps/web/src/i18n` 下的内容翻译包含 `de`、`fr`、`ru`，但当前翻译覆盖不完整。
- 这些内容型 i18n 翻译需要改为非强制性，避免内容型贡献者必须补全相关语言内容。

### Goals

- 降低内容型贡献的门槛。
- 降低补全多语言内容时产生冲突的几率。

### Scope

- 调整 `apps/web/src/i18n` 下内容型翻译的要求，使 `de`、`fr`、`ru` 这类不完整翻译可选。

### Success Criteria

- 内容型贡献者可以提交主要内容变更，无需同时补全 `de`、`fr`、`ru` 的所有内容型 i18n 翻译。
- 不完整的 `de`、`fr`、`ru` 内容翻译不会阻塞相关贡献流程。

## Research

### Existing System

- `apps/web/src/i18n/content.ts` 聚合 `de`、`ru`、`fr` 三个 content bundle，并从各 bundle 的字典 key 构建 `LOCALIZED_CONTENT_IDS`。Source: `apps/web/src/i18n/content.ts:954-996`
- 当前 content ids 覆盖 6 类资源：skills、designSystems、designSystemCategories、promptTemplates、promptTemplateCategories、promptTemplateTags。Source: `apps/web/src/i18n/content.ts:26-33,981-989`
- 运行时本身已有英文 fallback：skill description / prompt、design-system summary、design-system category、prompt-template category / tags、prompt-template title / summary 缺翻译时会回退到源内容或原始标签。Source: `apps/web/src/i18n/content.ts:1010-1053`
- Web 单元测试确认 localized ids 只来自 localized dictionaries，同时确认缺少 localized copy 时字段级回退到英文源内容或原始 tag。Source: `apps/web/tests/i18n/content.test.ts:12-19,21-80`
- E2E localized-content 测试会从仓库真实资源读取 skills、design systems、prompt templates，并对 `de`、`fr`、`ru` 循环验证 display content。Source: `e2e/tests/localized-content.test.ts:333-377`

### Current Mandatory Translation Triggers

- Design System 新增全新 category 会触发强制补全：测试从 `design-systems/*/DESIGN.md` 的 `> Category:` 提取 category，并要求每个 locale 的 `ids.designSystemCategories` 包含所有发现到的 category。Source: `e2e/tests/localized-content.test.ts:194-240,390,398-401`
- Prompt Template 新增全新 category 会触发强制补全：测试从 `prompt-templates/image/*.json` 和 `prompt-templates/video/*.json` 读取 `category`，缺省为 `General`，并要求每个 locale 的 `ids.promptTemplateCategories` 覆盖所有发现到的 category。Source: `e2e/tests/localized-content.test.ts:243-330,391-405`
- Prompt Template 新增全新 tag 会触发强制补全：测试读取 prompt template 的 `tags` 数组并要求每个 locale 的 `ids.promptTemplateTags` 覆盖所有发现到的 tag。Source: `e2e/tests/localized-content.test.ts:313-318,394-409`
- Featured Skill / Design Template 的 locale 专属展示文案要求来自贡献文档：设置 `od.featured: 1` 时，文档要求在 `content.ts`、`content.fr.ts`、`content.ru.ts` 添加完整 localized display copy。Source: `docs/skills-contributing.md:197-202`

### Non-Mandatory or Already-Fallback Paths

- 新增普通 skill 或 design template 时，E2E 测试要求资源可显示；非 featured 路径通过 `SKILL.md` 英文 display fields 作为 fallback。Source: `docs/skills-contributing.md:188-195`; `e2e/tests/localized-content.test.ts:155-191,351-357`
- 新增 design system summary 时，文档说明 localized summary 字典只在已有翻译时更新，默认英文 fallback 自动生效。Source: `docs/design-systems.md:251-273`
- 新增 prompt template title / summary 时，E2E 测试只要求 localized result 非空；运行时会在缺 localized prompt-template copy 时回退到英文 `title` 和 `summary`。Source: `e2e/tests/localized-content.test.ts:366-375`; `apps/web/src/i18n/content.ts:1045-1051`
- Scenario tag 的 UI 标签使用 `SCENARIO_LABEL_KEY` 中的固定 i18n key；未知 tag 会 title-case 原 tag。Source: `apps/web/src/components/ExamplesTab.tsx:51-70,423-431`

### Available Approaches

- 调整 E2E category/tag 覆盖断言，让 `de`、`fr`、`ru` content dictionaries 对 design-system categories、prompt-template categories、prompt-template tags 变为可选，并依赖现有运行时 fallback。Source: `e2e/tests/localized-content.test.ts:380-409`; `apps/web/src/i18n/content.ts:1031-1052`
- 保留资源可显示的 smoke coverage：继续验证 skills、design systems、prompt templates 在 `de`、`fr`、`ru` 下会得到非空展示内容。Source: `e2e/tests/localized-content.test.ts:333-377`
- 更新贡献文档，把 featured localized copy 从强制要求改为可选或推荐，并明确英文 fallback 路径。Source: `docs/skills-contributing.md:188-202`
- 同步更新覆盖文档中关于 localized-content 的描述，使其表达“可显示 + fallback”而非“每个 locale 都覆盖所有 id / category / tag”。Source: `docs/testing/e2e-coverage/settings.md:68-69,121`

### Constraints & Dependencies

- `LOCALIZED_CONTENT_IDS` 目前直接由 localized dictionaries 的 key 生成；任何仍使用这些 ids 做 array-containing 全量覆盖的测试都会把缺翻译变成阻塞。Source: `apps/web/src/i18n/content.ts:981-996`; `e2e/tests/localized-content.test.ts:398-409`
- Prompt template category 缺失时会被测试资源读取逻辑归为 `General`；新增 template 未设置 category 时仍会纳入 `General` 的覆盖集合。Source: `e2e/tests/localized-content.test.ts:311-312`
- Prompt template tags 会过滤掉非字符串和空字符串，强制覆盖只发生在有效非空 tag 上。Source: `e2e/tests/localized-content.test.ts:313-318`
- 贡献文档当前把 featured localized copy 标为 required path；实现变更需要同步文档，否则内容型贡献者仍会被文档要求补齐翻译。Source: `docs/skills-contributing.md:197-202,232-241`

### Key References

- `apps/web/src/i18n/content.ts:954-1053` - localized bundle、content ids、runtime fallback。
- `e2e/tests/localized-content.test.ts:333-409` - localized display coverage 与 category/tag 强制覆盖断言。
- `apps/web/tests/i18n/content.test.ts:12-80` - localized ids 与 fallback 单元测试。
- `docs/skills-contributing.md:188-202,232-241` - skill / design-template i18n 贡献要求。
- `docs/design-systems.md:251-273` - design-system localized summary fallback 文档。
- `docs/testing/e2e-coverage/settings.md:68-69,121` - e2e coverage 文档对 localized-content 的描述。

## Design

<!-- Technical approach, architecture decisions, and test strategy. Each design decision should cite a fact source. -->

## Plan

<!-- Optional: Step breakdown for complex features that need multiple implementation steps.
     Decided during Design. Checked off during Implement.
     Keep this section compact and step-based.
     Use markdown checkboxes for all step and substep items, for example:
     - [ ] Step 1: Foo
       - [ ] Substep 1.1 Implement: Foo foundation
       - [ ] Substep 1.2 Implement: Foo integration
       - [ ] Substep 1.3 Implement: Foo edge handling
       - [ ] Substep 1.4 Verify: Foo automated coverage
       - [ ] Substep 1.5 Verify: Foo manual workflow
     - [ ] Step 2: Bar
       - [ ] Substep 2.1 Implement: Bar
       - [ ] Substep 2.2 Verify: Bar
     - [ ] Step 3: Baz
       - [ ] Substep 3.1 Implement: Baz
       - [ ] Substep 3.2 Verify: Baz
     Use a capability-based step breakdown with reviewable, meaningful increments.
     Good boundaries align with one user-visible workflow, one subsystem/integration boundary, one migration/rollout step, or one stabilization milestone.
     Each step must include small, independent substeps for implementation and immediate testing/verification.
     Within each step, list implementation substeps before verification substeps.
     The final step may focus on overall testing/verification, edge cases, regression coverage, and coverage improvements.
     A step is complete only when relevant tests pass.
     Size steps so one coding agent can implement + validate in a single session.
     Write each substep as one small, independent task. -->

## Notes

<!-- Optional sections — add what's relevant. -->

### Implementation

<!-- Files created/modified, decisions made during coding, deviations from design -->

### Verification

<!-- How the feature was verified: tests written, manual testing steps, results -->
