# Email Preview Delivery Fidelity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make preview and copied email HTML match the recipient-visible message, remove the outer coloured wrapper, and refresh the AYSBC default template from its source email.

**Architecture:** Keep email-delivery markup generation in `emailHtmlGenerator`, preview-only chrome in `EmailPreview`, and settings UI in `EmailSettings`. Add one dependency-free assertion script to lock in the generated-HTML contract. No new runtime libraries or drag-and-drop abstractions are needed.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, Node `assert` via `tsx`.

---

## Chunk 1: Delivery markup and diagnostics

### Task 1: Lock in the generated-email contract

**Files:**
- Create: `scripts/verify-email-html.ts`
- Modify: `package.json`
- Modify: `src/lib/emailHtmlGenerator.ts`

- [ ] **Step 1: Write the failing assertion script**

Create `scripts/verify-email-html.ts` using Node `assert`. Import
`generateEmailHtml`, build a minimal `EmailTemplate` whose `externalBg` is
`#00ff00`, and assert that `html` and `copyHtml` do not contain that colour,
outer padding `24px 8px`, `box-shadow`, or the template border radius. Assert
that `contentBg` still appears and a localhost logo produces the exact warning
that recipients cannot load it and clipboard copy attempts to embed it. Add the
`"verify:email-html": "tsx scripts/verify-email-html.ts"` script to
`package.json`.

- [ ] **Step 2: Run the assertion to verify it fails**

Run: `npm run verify:email-html`

Expected: FAIL because the current wrapper emits `externalBg`, outer padding,
rounded corners, and a generic HTTPS warning.

- [ ] **Step 3: Add the minimal output change**

In `src/lib/emailHtmlGenerator.ts`, render one full-width white parent table
with a centred content table. Preserve `contentBg`, `maxWidth`, typography, and
content padding. Remove the `externalBg`-derived background, outer wrapper
padding, `border-radius`, and `box-shadow` from both `html` and `copyHtml`.
Refine `checkImageUrl` to distinguish insecure `http://` URLs from relative,
localhost, `127.0.0.1`, same-origin, and blob URLs that recipients cannot load;
mention that clipboard copy attempts to embed local assets.

Use a guarded `typeof window !== 'undefined'` check for same-origin detection;
in the Node assertion script treat only explicit local forms (`localhost`,
`127.0.0.1`, relative paths, and `blob:`) as local. This keeps the generator
safe in browser and Node contexts without introducing configuration.

- [ ] **Step 4: Run the assertion to verify it passes**

Run: `npm run verify:email-html`

Expected: PASS with a single success message.

- [ ] **Step 5: Commit**

```powershell
git add package.json scripts/verify-email-html.ts src/lib/emailHtmlGenerator.ts
git commit -m "fix: generate delivery-safe email markup"
```

## Chunk 2: Preview and settings UX

### Task 2: Render preview without nested scrolling

**Files:**
- Modify: `src/components/email-builder/EmailPreview.tsx`
- Modify: `src/components/email-builder/EmailSettings.tsx`

- [ ] **Step 1: Implement iframe sizing with native browser APIs**

In `EmailPreview.tsx`, use an iframe ref and `onLoad` to set its height from
`contentDocument.documentElement.scrollHeight`. Attach a `ResizeObserver` to the
iframe document body when available and clean it up on document replacement.
Keep the modal workspace as the only scroll container. Remove `h-full`, the
inner absolute iframe layout, and decorative rounding/shadow from the email
frame. Keep desktop constrained to `maxWidth` and mobile at 375px with
`maxWidth: '100%'`.

- [ ] **Step 2: Reuse one generated result**

Destructure `subject`, `html`, and `warnings` from one `generateEmailHtml`
call, using `subject` for the preview title so mock data is consistent.
Rename the warning header from syntax warnings to delivery warnings.

- [ ] **Step 3: Remove misleading external-background control**

In `EmailSettings.tsx`, remove the External Background `ColorField` and adjust
the helper copy so it only describes the content background. Do not remove the
stored type field so existing local templates remain compatible.

- [ ] **Step 4: Type-check and build**

Run: `npm run lint; npm run build`

Expected: both commands exit 0.

- [ ] **Step 5: Verify the preview in a browser**

Run: `npm run dev`

Open the local app, open the AYSBC template, and select Xem trước. Check both
desktop and mobile modes: the grey workspace is the only scrolling region, the
iframe fits the full message with no internal scrollbar, long source content is
not clipped, the email has no green outer frame, and changing mock data updates
both subject and body.

- [ ] **Step 6: Commit**

```powershell
git add src/components/email-builder/EmailPreview.tsx src/components/email-builder/EmailSettings.tsx
git commit -m "fix: align email preview with delivery output"
```

## Chunk 3: AYSBC template fidelity and verification

### Task 3: Refresh the default AYSBC email

**Files:**
- Modify: `src/data/defaultEmailTemplates.ts`

- [ ] **Step 1: Update message blocks from the source PDF**

Update the default AYSBC blocks to preserve its single-column flow: personalised
greeting; AYSBC/Science Centre introduction; badge-method heading and content;
age-group heading and class 1–6 / 7–12 bullets; AYSBC information banner;
competition journey and prize bullets; the 22/07/2026 deadline; CTA pair
“Đăng ký tham gia cho con” and “Follow page AYSBC Việt Nam”; and the FermatTech
signature. Keep known public URLs HTTPS and retain the registration variable
for the first CTA.

- [ ] **Step 2: Verify static template content**

Extend `scripts/verify-email-html.ts` to import the default template and assert
the generated HTML contains stable source-section markers: `Science Centre
Singapore Global`, `Phương pháp học qua Huy hiệu`, `Bảng A - C`, `AYSBC 2026`,
`Hành trình chinh phục AYSBC 2026`, `Phần thưởng & Cơ hội giao lưu quốc tế`,
`22/07/2026`, `Đăng ký tham gia cho con`, `Follow page AYSBC Việt Nam`, and
`BAN TỔ CHỨC AYSBC VIỆT NAM`.

- [ ] **Step 3: Run all checks**

Run: `npm run verify:email-html; npm run lint; npm run build`

Expected: all commands exit 0.

- [ ] **Step 4: Commit**

```powershell
git add src/data/defaultEmailTemplates.ts scripts/verify-email-html.ts
git commit -m "feat: refresh AYSBC email template"
```
