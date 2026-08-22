import { TFile } from "obsidian"
import { JIRA_KEY_REGEX } from "./interfaces/settingsInterfaces"
import RC from "./rendering/renderingCommon"
import { SettingsData } from "./settings"

function extractIssueKeys(value: unknown): string[] {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return []
    }
    return value.toString().toUpperCase().match(new RegExp(JIRA_KEY_REGEX, 'g')) || []
}

// Map every issue key referenced by the notes frontmatter property to the notes that reference it.
export function buildNotesByIssueKey(): Record<string, TFile[]> {
    const notesByIssueKey: Record<string, TFile[]> = {}
    const property = SettingsData.notesProperty
    if (!property) {
        return notesByIssueKey
    }
    for (const note of RC.getNotes()) {
        const propertyValue = RC.getFrontMatter(note)?.[property]
        if (!propertyValue) {
            continue
        }
        const values = Array.isArray(propertyValue) ? propertyValue : [propertyValue]
        for (const value of values) {
            for (const issueKey of extractIssueKeys(value)) {
                if (!notesByIssueKey[issueKey]) {
                    notesByIssueKey[issueKey] = []
                }
                if (!notesByIssueKey[issueKey].includes(note)) {
                    notesByIssueKey[issueKey].push(note)
                }
            }
        }
    }
    return notesByIssueKey
}
