# Polar review response — content moderation question

Polar asked: "Does the AI image generation include any NSFW safeguards or
content restrictions, and are users prevented from generating
copyrighted/trademarked or other disallowed imagery?"

Two versions below. **Use the "Paste-ready (plain text)" block** in their
form — it has no markdown markers, so it submits cleanly into a plain
textarea. The annotated version is just for your reference.

---

## Paste-ready (plain text)

Copy everything between the bars, paste into Polar.

────────────────────────────────────────────────────────────────────

Ambient does not perform its own AI generation. It is a thin client that
sends the user's prompt directly to one of two upstream providers and
renders the returned image locally as a desktop wallpaper. No
server-side component, no proxy, no storage operated by us, no
fine-tuned or self-hosted model. Generated images go straight to the
user's own filesystem; we never see them.

Content moderation therefore comes from the upstream providers:

— OpenAI DALL-E 3 (BYOK — the user provides their own API key): OpenAI
enforces its full content policy at the API level, refusing NSFW
imagery, real-person likenesses, copyrighted or trademarked characters
and IPs, violent content, and so on. The user is also bound by their
own OpenAI Terms of Service.

— Pollinations.ai (free public API, no user key required): applies
safety filters via its model backends and its own moderation layer. Its
Terms of Service prohibit NSFW, illegal, and infringing content.

Ambient adds no jailbreak layer, no prompt rewriting, no policy bypass.
Anything the upstream provider refuses, Ambient simply surfaces that
refusal to the user.

Beyond the AI path, the app's two other image-acquisition modes inherit
moderation from their respective hosts as well:

— Curated photo sources (NASA Astronomy Picture of the Day, Unsplash,
Pexels): all editorially or community-moderated platforms with their
own content policies.

— Local pattern generation: abstract Canvas rendering — mesh gradients,
geometric shapes, dot grids, stripes, and emoji wallpapers using
Microsoft's MIT-licensed Fluent emoji set. Pure mathematical visuals;
no content risk vector.

Ambient does not host, share, or distribute any image. There is no
upload feature, no marketplace, no social or hosted gallery. The
product produces wallpapers on the buyer's own machine for their
personal use as the desktop background.

────────────────────────────────────────────────────────────────────

## Optional add-on (only if they push for more detail on Pollinations)

If they come back with a follow-up specifically about Pollinations'
moderation rigor — since it's the more permissive of the two providers
— you can add this paragraph:

────────────────────────────────────────────────────────────────────

To be fully transparent about Pollinations: it operates at
community-grade moderation rather than enterprise-grade. Its Terms of
Service (pollinations.ai/terms) prohibit problematic content, but a
determined user could likely generate output that the upstream model
permits. This is the same risk profile as any consumer image-generation
UI such as Krea, Tensor.Art, or Civitai's hosted playgrounds, and
substantially safer than running an unfiltered local Stable Diffusion
build. Users who want strict commercial-grade moderation can switch
Ambient to the OpenAI DALL-E 3 backend at no cost to us.

────────────────────────────────────────────────────────────────────

## Why this answer should pass Polar's review

The three things their reviewer is checking:

1. Are you the responsible moderator, or is moderation handled
   upstream? — Upstream. OpenAI and Pollinations are. You're a client.
2. Could your service be used to distribute disallowed content? — No.
   No server-side storage, no marketplace, no upload. Output is local
   to the buyer's machine.
3. Is trademark / copyright protection enforced anywhere in the chain?
   — Yes. DALL-E 3 has industry-leading rejection of named-IP prompts;
   Pollinations enforces via ToS plus model-side filters.
