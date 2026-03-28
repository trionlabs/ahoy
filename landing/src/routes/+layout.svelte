<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Ahoy - Phone Numbers for AI Agents</title>
	<meta name="description" content="Phone numbers for AI agents with calls and SMS. All your agents share the same number via World ID." />
</svelte:head>

{@render children()}
