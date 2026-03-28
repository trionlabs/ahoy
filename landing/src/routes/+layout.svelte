<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>ahoy - Phone numbers for AI agents</title>
	<meta name="description" content="Phone numbers for AI agents with calls and SMS. All your agents share the same numbers via World ID." />
</svelte:head>

{@render children()}
