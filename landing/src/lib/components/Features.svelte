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
</script>

<section
	use:observe
	class="reveal px-5 sm:px-10 lg:px-16 py-16 sm:py-24 lg:py-28 max-w-5xl mx-auto w-full {jsReady ? 'js-ready' : ''} {visible ? 'visible' : ''}"
>
	<div class="mb-10 sm:mb-14">
		<h2 class="font-display text-[1.1rem] sm:text-[clamp(1.2rem,2.2vw,1.6rem)] font-700 text-ink tracking-[-0.02em] leading-[1.15]">
			Every number ships with
		</h2>
	</div>

	<div>
		<div class="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-0 py-4 sm:py-5 border-t border-stroke">
			<h3 class="font-display text-[0.9rem] sm:text-[0.95rem] lg:text-[1.05rem] font-600 text-ink tracking-[-0.015em] sm:w-2/5">
				SMS Inbox
			</h3>
			<p class="text-[12.5px] sm:text-[13px] text-ink-secondary leading-[1.6] sm:leading-[1.65] sm:w-3/5">
				Your agents' phone number receives real SMS. Read from the dashboard or pull via API.
			</p>
		</div>

		<div class="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-0 py-4 sm:py-5 border-t border-stroke">
			<h3 class="font-display text-[0.9rem] sm:text-[0.95rem] lg:text-[1.05rem] font-600 text-ink tracking-[-0.015em] sm:w-2/5">
				Voice AI
			</h3>
			<p class="text-[12.5px] sm:text-[13px] text-ink-secondary leading-[1.6] sm:leading-[1.65] sm:w-3/5">
				Incoming calls get a live AI conversation — context-aware, per-call memory. Not a phone tree.
			</p>
		</div>

		<div class="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-0 py-4 sm:py-5 border-t border-b border-stroke">
			<h3 class="font-display text-[0.9rem] sm:text-[0.95rem] lg:text-[1.05rem] font-600 text-ink tracking-[-0.015em] sm:w-2/5">
				XMTP Bridge
			</h3>
			<p class="text-[12.5px] sm:text-[13px] text-ink-secondary leading-[1.6] sm:leading-[1.65] sm:w-3/5">
				Every SMS is forwarded to XMTP. Your agents listen on-chain — no phone hardware, no carrier.
			</p>
		</div>
	</div>

	<div class="mt-10 sm:mt-14 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
		<a
			href="https://useahoy.app/app"
			class="group inline-flex items-center gap-2 self-start rounded-full bg-ink text-bone px-6 sm:px-7 py-2.5 sm:py-3 text-[13px] sm:text-[14px] font-body font-500 tracking-[-0.01em] hover:shadow-[0_4px_20px_rgba(0,0,0,0.15)] active:scale-[0.97]"
		>
			Get Your Number
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
				<line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" />
			</svg>
		</a>
		<p class="text-[11px] sm:text-[12px] text-ink-muted">No subscription. Renew when you want.</p>
	</div>
</section>
