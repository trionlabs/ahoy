<script lang="ts">
	let copied = $state(false);
	const command = 'npx skills add github:trionlabs/ahoy';

	function copy() {
		navigator.clipboard.writeText(command);
		copied = true;
		setTimeout(() => copied = false, 2000);
	}
</script>

<section class="px-5 sm:px-10 lg:px-16 py-16 sm:py-24 lg:py-28 max-w-5xl mx-auto w-full">
	<div class="mb-8 sm:mb-10">
		<p class="text-[11px] sm:text-[12px] font-body font-500 text-ink-muted uppercase tracking-[0.1em] mb-3">
			For Agents
		</p>
		<h2 class="font-display text-[1.1rem] sm:text-[clamp(1.2rem,2.2vw,1.6rem)] font-700 text-ink tracking-[-0.02em] leading-[1.15]">
			Add phone capabilities in one command
		</h2>
	</div>

	<button
		onclick={copy}
		class="group w-full sm:w-auto flex items-center justify-between gap-4 rounded-xl border border-stroke bg-frame px-5 sm:px-6 py-3.5 sm:py-4 cursor-pointer hover:border-ink-muted active:scale-[0.99] transition-all"
	>
		<code class="text-[13px] sm:text-[14px] font-mono text-ink tracking-[-0.01em]">
			{command}
		</code>
		<span class="text-[11px] sm:text-[12px] text-ink-muted font-body shrink-0 group-hover:text-ink transition-colors">
			{copied ? 'Copied!' : 'Copy'}
		</span>
	</button>

	<p class="mt-4 sm:mt-5 text-[12.5px] sm:text-[13px] text-ink-secondary leading-[1.6]">
		Installs the ahoy skill into your agent. Gives it everything it needs to provision numbers, send SMS, receive calls, and bridge to XMTP.
	</p>

	<div class="mt-6 sm:mt-8 flex flex-wrap gap-2">
		<a href="https://raw.githubusercontent.com/trionlabs/ahoy/main/skills/ahoy/SKILL.md" target="_blank" rel="noopener noreferrer"
			class="inline-flex items-center gap-1.5 rounded-full border border-stroke px-4 py-1.5 text-[11px] sm:text-[12px] font-body text-ink-secondary hover:text-ink hover:border-ink-muted transition-colors">
			Read SKILL.md
		</a>
		<a href="https://useahoy.app/openapi.json" target="_blank" rel="noopener noreferrer"
			class="inline-flex items-center gap-1.5 rounded-full border border-stroke px-4 py-1.5 text-[11px] sm:text-[12px] font-body text-ink-secondary hover:text-ink hover:border-ink-muted transition-colors">
			OpenAPI Spec
		</a>
		<a href="https://www.x402scan.com/server/bdb3de57-750e-42d0-b7e1-a54a5c809871" target="_blank" rel="noopener noreferrer"
			class="inline-flex items-center gap-1.5 rounded-full border border-stroke px-4 py-1.5 text-[11px] sm:text-[12px] font-body text-ink-secondary hover:text-ink hover:border-ink-muted transition-colors">
			x402scan
		</a>
	</div>
</section>
