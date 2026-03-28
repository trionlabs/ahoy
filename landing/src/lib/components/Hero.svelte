<script lang="ts">
	import { onMount } from 'svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	let animate = $state(false);

	onMount(() => {
		requestAnimationFrame(() => (animate = true));
	});
</script>

<section class="px-3 sm:px-4 lg:px-5 pt-3 sm:pt-4 pb-3 sm:pb-4">

	<!-- Nav -->
	<nav class="flex items-center justify-between w-full mb-2.5 sm:mb-3 px-2 sm:px-6 lg:px-11">
		<a href="/" class="flex items-center gap-1.5 sm:gap-2">
			<svg width="16" height="16" viewBox="0 0 82 110" fill="none" class="text-ink sm:w-4.5 sm:h-4.5">
				<path d="M41 0C18.36 0 0 18.36 0 41v68h10V41c0-17.09 13.91-31 31-31s31 13.91 31 31v68h10V41C82 18.36 63.64 0 41 0z" fill="currentColor"/>
				<rect x="28" y="30" width="10" height="38" rx="2" fill="currentColor"/>
				<rect x="44" y="30" width="10" height="38" rx="2" fill="currentColor"/>
				<rect x="0" y="80" width="82" height="10" rx="2" fill="currentColor"/>
			</svg>
			<span class="font-display text-[1rem] sm:text-[1.15rem] font-800 tracking-[-0.04em] text-ink uppercase">Ahoy!</span>
		</a>
		<div class="flex items-center gap-2 sm:gap-3">
			<ThemeToggle />
			<a
				href="https://useahoy.app/app"
				class="group inline-flex items-center gap-1.5 sm:gap-2 rounded-full border border-stroke bg-cream px-4 sm:px-5 py-1.5 sm:py-2 text-[12px] sm:text-[13px] font-body font-500 text-ink hover:bg-ink hover:text-bone hover:border-ink active:scale-[0.97]"
			>
				Launch App
				<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
					<line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" />
				</svg>
			</a>
		</div>
	</nav>

	<!-- Frame -->
	<div class="relative min-h-[calc(100dvh-4rem)] rounded-xl sm:rounded-2xl lg:rounded-3xl bg-frame overflow-hidden">

		<div class="stagger min-h-[calc(100dvh-4rem)] flex flex-col justify-between px-5 sm:px-10 lg:px-16 py-7 sm:py-10 lg:py-14 {animate ? 'animate' : ''}">

			<!-- Top label -->
			<div>
				<p class="text-[10px] sm:text-[11px] font-body font-500 text-ink-muted uppercase tracking-[0.12em] sm:tracking-[0.14em]">
					ahoy — phone infrastructure for agents
				</p>
			</div>

			<!-- Headline + bubbles -->
			<div class="my-auto py-6 sm:py-10 lg:py-14">
				<h1 class="font-display font-800 leading-[0.88] sm:leading-[0.9] tracking-[-0.04em] sm:tracking-[-0.045em] text-ink uppercase text-[2.4rem] sm:text-[clamp(3rem,8vw,7.5rem)]">
					Your Agents.<br />
					One Number.
				</h1>

				<p class="mt-5 sm:mt-8 text-[14px] sm:text-[15px] lg:text-[16px] font-body font-400 text-ink-secondary leading-[1.6] sm:leading-[1.65] tracking-[-0.01em] max-w-md">
					Verify once with World&nbsp;ID. Every agent you deploy gets the same phone number.
				</p>

				<!-- Chat bubbles -->
				<div class="mt-5 sm:mt-6 flex flex-col gap-1 items-start pl-1.5">
					<div class="bubble bubble-call bubble-tail">
						<svg class="bubble-icon shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
						</svg>
						<span>Calls answered by AI.</span>
					</div>
					<div class="bubble bubble-sms">
						<svg class="bubble-icon shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
						</svg>
						<span>Texts in your inbox.</span>
					</div>
					<div class="bubble bubble-xmtp">
						<svg class="bubble-icon shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>
						</svg>
						<span>Messages bridged to XMTP.</span>
					</div>
				</div>
			</div>

			<!-- Bottom CTA -->
			<div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 sm:gap-6">
				<a
					href="https://useahoy.app/app"
					class="group inline-flex items-center gap-2 self-start rounded-full bg-ink text-bone px-6 sm:px-7 py-2.5 sm:py-3 text-[13px] sm:text-[14px] font-body font-500 tracking-[-0.01em] hover:shadow-[0_4px_20px_rgba(0,0,0,0.15)] active:scale-[0.97]"
				>
					Get Your Number
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 sm:w-3.25 sm:h-3.25">
						<line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" />
					</svg>
				</a>
				<p class="text-[11px] sm:text-[12px] text-ink-muted font-body font-400">
					$0.10 &middot; 30 days &middot; no subscription
				</p>
			</div>
		</div>
	</div>
</section>
