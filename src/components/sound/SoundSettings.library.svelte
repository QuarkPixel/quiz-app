<script lang="ts">
    import { SHORTCUTS } from "@/config";
    import { modKeyLabel } from "$lib/platform";
    import { Kbd, KbdGroup } from "$lib/components/ui/kbd";
    import { Label } from "$lib/components/ui/label";
    import { Switch } from "$lib/components/ui/switch";
    import { useQuizSession } from "@/quiz/session/context";

    const session = useQuizSession();
</script>

<div class="flex items-center justify-between gap-3">
    <Label for="sound-enabled" class="flex items-center gap-2 text-sm font-normal">
        音效
        <KbdGroup class="text-[10px]">
            <Kbd>{modKeyLabel}</Kbd>
            <Kbd>{SHORTCUTS.toggleSound.toUpperCase()}</Kbd>
        </KbdGroup>
    </Label>
    <Switch
        id="sound-enabled"
        checked={session.appState.settings.soundEnabled === true}
        onCheckedChange={(checked) => session.setSoundEnabled(checked)}
        size="sm"
    />
</div>
