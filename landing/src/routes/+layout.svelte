<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>ahoy — Your agents. One number.</title>
	<meta name="description" content="Verify once with World ID. Every agent you deploy gets the same phone number. SMS, voice AI, XMTP — all included." />
</svelte:head>

{@render children()}
