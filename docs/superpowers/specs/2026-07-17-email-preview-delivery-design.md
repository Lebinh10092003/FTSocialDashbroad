# Email preview delivery fidelity

## Goal

Make the email preview match the HTML that users copy into an email client. The
preview must not display an outer coloured frame around the message, such as the
green frame currently shown for the AYSBC template. The default message surface
is white; a deliberate `contentBg` setting remains allowed inside the email.

## Scope

- Generate copyable email HTML with a content-only wrapper. It must not include
  the configurable external background, outer padding, rounded corners, or a
  box shadow.
- Update the preview dialog so its neutral editor canvas is separate from the
  generated email. The message itself renders as a plain white email surface.
- Keep desktop and mobile previews responsive and make the subject line use the
  same mock-data mode as the rendered message.
- Improve image URL diagnostics: local and localhost URLs should explain that
  recipients cannot load them; HTTP URLs remain a security warning.
- Update the AYSBC 2026 default template to align with the supplied source
  email at `C:\Users\Admin\Downloads\Thư Fermat Education - Re_ [AYSBC 2026]
  Biến căn bếp và khu vườn thành phòng thí nghiệm chuẩn Singapore cùng con.pdf`:
  single-column reading flow; introduction; Badge-method section; age-group
  section; AYSBC information banner; competition journey; prize section;
  22/07/2026 registration deadline; two CTAs; and FermatTech signature.

## Non-goals

- Sending test email, inbox-client screenshots, and a full Gmail/Outlook shell.
- A new drag-and-drop engine or changes to stored user templates beyond normal
  default-template restoration.

## Design

`generateEmailHtml` will provide a delivery-safe HTML document and a matching
copy fragment. Both use a full-width white parent and a centred content table
only; email client unsafe visual effects are removed. `contentBg` remains the
delivery message background. `externalBg` is removed from the email-settings UI
and is ignored in output; the existing field is retained only so saved templates
remain readable.

`EmailPreview` will own the neutral grey workspace around the generated
document. Its email frame will no longer add decorative rounding or shadow. The
desktop frame is constrained to the template maximum width; the mobile frame is
375px wide with a viewport-safe maximum width. The rendered document and the
subject are generated from one common result so mock-data behaviour remains in
sync. The iframe's document height is read after load and whenever its content
resizes, then applied to the iframe element. The outer preview workspace scrolls
while the email frame has no fixed height or inner document scrollbar, preventing
long messages from being clipped.

URL warnings describe the source that is currently rendered in the iframe.
`http://` image URLs are flagged as insecure. Relative paths, `localhost`,
`127.0.0.1`, same-origin development URLs, and `blob:` URLs are flagged because
they are only available locally and recipients may not see them. The warning
also explains that same-origin and blob images are embedded as data URLs when
copying succeeds, so the copy pipeline can still produce a usable email.

## Validation

- Type-check and production build pass.
- Verify generated HTML has no wrapper style sourced from `externalBg`, no
  outer padding, and no rounded corners or box shadow.
- Verify desktop and mobile previews use one outer scroll area and do not clip
  content or create an iframe scrollbar.
- Verify a localhost image reports a recipient-visible image problem.
- Verify the default template contains each AYSBC source section and the
  22/07/2026 deadline.
