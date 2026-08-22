jest.mock('../src/settings', () => {
    return { SettingsData: { notesProperty: 'jira' } }
})
jest.mock('../src/rendering/renderingCommon', () => {
    return { __esModule: true, default: { getNotes: jest.fn(), getFrontMatter: jest.fn() } }
})

import { TFile } from 'obsidian'
import { buildNotesByIssueKey } from '../src/notesIndex'
import RC from '../src/rendering/renderingCommon'
import { SettingsData } from '../src/settings'

const getNotesMock = RC.getNotes as jest.Mock
const getFrontMatterMock = RC.getFrontMatter as jest.Mock

function note(path: string): TFile {
    return { path: path, name: path.split('/').pop() } as TFile
}

// Configure the mocked vault with the given notes and their frontmatter
function setNotes(notes: Record<string, any>): TFile[] {
    const files = Object.keys(notes).map(path => note(path))
    getNotesMock.mockReturnValue(files)
    getFrontMatterMock.mockImplementation((file: TFile) => notes[file.path])
    return files
}

describe('NotesIndex', () => {
    beforeEach(() => {
        SettingsData.notesProperty = 'jira'
        jest.resetAllMocks()
    })

    test('Plain issue key', () => {
        const [file] = setNotes({ 'Notes/My note.md': { jira: 'AAA-123' } })
        expect(buildNotesByIssueKey()).toEqual({ 'AAA-123': [file] })
    })

    test('Lower case issue key', () => {
        const [file] = setNotes({ 'My note.md': { jira: 'aaa-123' } })
        expect(buildNotesByIssueKey()).toEqual({ 'AAA-123': [file] })
    })

    test('List of issue keys', () => {
        const [file] = setNotes({ 'My note.md': { jira: ['AAA-123', 'BBB-1'] } })
        expect(buildNotesByIssueKey()).toEqual({ 'AAA-123': [file], 'BBB-1': [file] })
    })

    test('Wiki link', () => {
        const [file] = setNotes({ 'My note.md': { jira: '[[AAA-123 Some title]]' } })
        expect(buildNotesByIssueKey()).toEqual({ 'AAA-123': [file] })
    })

    test('Issue url', () => {
        const [file] = setNotes({ 'My note.md': { jira: 'https://mycompany.atlassian.net/browse/AAA-123' } })
        expect(buildNotesByIssueKey()).toEqual({ 'AAA-123': [file] })
    })

    test('Multiple notes on the same issue', () => {
        const [file1, file2] = setNotes({
            'note1.md': { jira: 'AAA-123' },
            'note2.md': { jira: 'AAA-123' },
        })
        expect(buildNotesByIssueKey()).toEqual({ 'AAA-123': [file1, file2] })
    })

    test('Duplicated issue key in the same note', () => {
        const [file] = setNotes({ 'My note.md': { jira: ['AAA-123', 'AAA-123 duplicated'] } })
        expect(buildNotesByIssueKey()).toEqual({ 'AAA-123': [file] })
    })

    test('Custom property name', () => {
        SettingsData.notesProperty = 'issue'
        const [file] = setNotes({ 'My note.md': { issue: 'AAA-123', jira: 'BBB-1' } })
        expect(buildNotesByIssueKey()).toEqual({ 'AAA-123': [file] })
    })

    test('Feature disabled with an empty property name', () => {
        SettingsData.notesProperty = ''
        setNotes({ 'My note.md': { jira: 'AAA-123' } })
        expect(buildNotesByIssueKey()).toEqual({})
        expect(getNotesMock).not.toHaveBeenCalled()
    })

    test('Notes without frontmatter or without the property', () => {
        setNotes({
            'no-frontmatter.md': undefined,
            'empty-frontmatter.md': {},
            'other-property.md': { tags: ['AAA-123'] },
            'empty-value.md': { jira: '' },
            'not-a-key.md': { jira: 'no issue key here' },
            'invalid-type.md': { jira: { key: 'AAA-123' } },
        })
        expect(buildNotesByIssueKey()).toEqual({})
    })
})
