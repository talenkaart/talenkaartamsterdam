<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";

  let { onclick, locale } = $props();
</script>

<Button variant="outline" size="icon" {onclick}>
  {locale === "nl" ? "NL" : "EN"}
</Button>
