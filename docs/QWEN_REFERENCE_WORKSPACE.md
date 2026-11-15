# Qwen Image 2.1 reference workspace

Use Create Image in Studio. This updates the existing workspace in place; it does not install a second image app. INT8 remains the default profile, and complete BF16 weights remain optional. H3 adapters and old Qwen-Image-Edit-2511 adapters are not interchangeable with Qwen 2.1.

## References and task workflows

Attach up to ten PNG/JPEG/WebP images, together or sequentially. Each image has its own mention name, role and instructions describing what to take, preserve or exclude. Roles cover identity, product, background, style/lighting, composition, pose, outfit, typography, mask/annotation and custom instructions. Context is the backward-compatible default and adds no role text.

Task workflows add instructions for combining images, replacing a subject/product or background, transferring style, local edits and transparent subject extraction. They do not replace the user's prompt. Roles and tasks are semantic prompt guidance over the same native image inputs, not independent ControlNet channels, masked latent inpainting or pixel locks. A mask is another reference; its black/white meaning and intended region should be explained in its instructions. Local edits can still alter surrounding pixels.

The first reference defines the canvas unless Use selected output size is enabled. Move the intended base image first. Other references can retain independent proportions and use the additional-detail setting. A selected canvas center-crops the base when its aspect differs. This is not outpainting. Auto fit applies before upload, including alpha-preserving PNG input.

Write `@person` in prompts or per-reference instructions. Preview resolved prompt and reference connections shows the actual `<imageN>` mapping. Names and native tokens follow reorder; renaming updates other instructions too. Removing a referenced image leaves an unresolved name and blocks submission until corrected, rather than silently applying its token to a different source. Unknown names and out-of-range native tokens are rejected.

Roles, instructions, task, negative prompt and cache settings survive refresh in the current tab. A new plain tab remains independent. Browser drafts are not server project backups. Existing server video project/scene management is unchanged; Qwen currently retains generated image metadata and tab drafts, not an equivalent server scene editor.

## Generation and reuse

Negative prompt reaches the native encoder's negative conditioning output. Auto guidance preserves CFG 1 without a negative prompt and uses CFG 2 when one is supplied; explicit CFG 1 with a negative prompt is rejected because it cannot influence sampling. Guidance above 1 is experimental, adds computation and can change quality; it is not a guaranteed exclusion. Reference cache uses Auto and lossless Default unless changed. CPU stores cache in host RAM. Off recomputes the prefix and can be slower. INT8/INT4 cache are experimental and can change outputs, with greater error for INT4.

Edit in Qwen makes the selected generated image the new sole reference and clears the old edit prompt. Add as reference appends it while preserving the current setup. Neither starts generation. Send to H3 retains the existing reference/start/end frame handoff. Original generated files remain intact until explicitly deleted.

## Official Turbo (optional)

Turbo INT8 and BF16 are separate selectable profiles. Their encoder and VAE are shared with the matching baseline profile; only the diffusion checkpoint is additional (INT8: 7,256,787,829 bytes). The UI enables a Turbo profile only when its files and custom-sampling nodes are present. It fixes eight Euler steps and the official explicit sigma schedule through ManualSigmas and SamplerCustomAdvanced. It never substitutes an ordinary eight-step baseline graph. Extra LoRAs, negative prompts and guidance other than 1 are rejected on this route.

Opt in through the existing launcher with `--qwen-image-profiles int8,turbo_int8` (Windows: the corresponding launcher argument). Existing baseline-only installs stay baseline-only. Downloads use pinned Comfy-Org revision `aacf31a6d48e707f352ecba714cee0680da3479b`, exact sizes and SHA-256. A ten-reference 512×512 Turbo smoke completed and decoded before the rental disconnected. General quality and speed still require representative output review. [Official Turbo model](https://huggingface.co/Qwen/Qwen-Image-2.1-Turbo) · [Comfy example](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_turbo_image_edit.json).

Prompt Enhancer checkpoints and Qwen Fun ControlNet were also found in the current upstream catalog. They are distinct optional downloads, not prerequisites for multi-reference editing. Prompt Enhancer has no integrated Studio button in this release; the user excluded ControlNet from the current rental. No inference backend replacement (Diffusers/vLLM/SGLang) is needed for this upgrade.

## Dependencies and evidence

No new model download or custom node pack is needed for the baseline reference controls; optional Turbo adds its checkpoint. The existing pinned ComfyUI 0.43.0 supplies TextEncodeQwenImage21 (ordered `images.image_N` inputs) and QwenImage21Cache. Readiness now also checks LoadImage. Profile sizes alone are not cryptographic verification; the launcher owns hash verification. Actual GPU inference and image quality must be reported separately from CPU/browser acceptance.

On 15 November 2026, the baseline INT8 files were found at expected sizes. Later, the official Turbo checkpoint passed SHA-256 verification and one eight-step native GPU graph with ten synthetic references completed and fully decoded at 512×512. These are historical observations from before server disconnection; they do not certify general visual quality.

Automated coverage includes ten distinct image uploads, all ten encoder connections, workflow/role prompt compilation, mention rename/reorder/removal, refresh persistence, negative/cache graph settings and result reuse. The browser fixture simulates queue/inference; it is not a GPU render.

Official references:

- [Qwen Image 2.1 model card](https://huggingface.co/Qwen/Qwen-Image-2.1): unified generation/editing, ten references, annotated/mask editing and RGBA.
- [Pinned ComfyUI native Qwen implementation](https://github.com/Comfy-Org/ComfyUI/blob/v0.43.0/comfy_extras/nodes_qwen.py): encoder inputs, native reference latent and cache semantics.
- [Qwen Image 2.1 source](https://github.com/QwenLM/Qwen-Image-2.1).
