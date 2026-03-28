<script lang="ts">
	let jsReady = $state(false);
	let visible = $state(false);

	function observe(node: HTMLElement) {
		jsReady = true;
		const observer = new IntersectionObserver(
			([entry]) => { if (entry.isIntersecting) visible = true; },
			{ threshold: 0.1 }
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	const steps = [
		{ num: '01', title: 'Verify', desc: 'Sign in with World ID. One tap. No documents, no wait.' },
		{ num: '02', title: 'Pay', desc: '$0.99 USDC. One-time. 30 days included.' },
		{ num: '03', title: 'Done', desc: 'Number is live. SMS, voice AI, XMTP — instantly.' }
	];
</script>

<section
	use:observe
	class="reveal px-5 sm:px-10 lg:px-16 py-16 sm:py-24 lg:py-28 max-w-5xl mx-auto w-full {jsReady ? 'js-ready' : ''} {visible ? 'visible' : ''}"
>
	<div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 sm:gap-3 mb-10 sm:mb-14">
		<h2 class="font-display text-[1.1rem] sm:text-[clamp(1.2rem,2.2vw,1.6rem)] font-700 text-ink tracking-[-0.02em] leading-[1.15]">
			Setup
		</h2>
		<p class="text-[11px] sm:text-[12px] font-body font-400 text-ink-muted">
			Under a minute. No phone needed.
		</p>
	</div>

	<div class="flex flex-col sm:grid sm:grid-cols-3 gap-0">
		{#each steps as step, i}
			<div class="py-5 sm:py-0 sm:pr-6 lg:pr-10 {i < steps.length - 1 ? 'border-b sm:border-b-0 sm:border-r border-stroke' : ''} {i > 0 ? 'sm:pl-6 lg:pl-10' : ''}">
				<span class="font-display text-[1.1rem] sm:text-[1.25rem] lg:text-[1.4rem] font-800 text-ink-muted/30 leading-none select-none block">
					{step.num}
				</span>
				<h3 class="font-display text-[0.85rem] sm:text-[0.9rem] font-600 text-ink tracking-[-0.01em] mt-2 sm:mt-2.5">
					{step.title}
				</h3>
				<p class="text-[12.5px] sm:text-[13px] text-ink-secondary leading-[1.6] sm:leading-[1.65] mt-1 sm:mt-1.5">
					{step.desc}
				</p>
			</div>
		{/each}
	</div>
</section>
