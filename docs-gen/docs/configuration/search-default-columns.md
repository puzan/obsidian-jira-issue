---
sidebar_position: 3
---
# Search default columns

This section allows to define the default columns to show with the [jira-search component](/docs/configuration/search-default-columns).

- Select from the drop down menu the column to display
- Choose if you want the column to be displayed in compact ![compact-icon](/img/compact-icon.png) or extended ![extended-icon](/img/extended-icon.png) mode
- Sort the columns in the table using the up and down buttons ![up-down-icon](/img/up-down-icon.png)
- Delete the columns using the delete button ![delete-icon](/img/delete-icon.png)
- The button `Add column` allows to insert a new column that can be then configure
- The button `Reset columns` restores the default columns configuration

:::caution
It is not possible to add custom fields columns from this view at the moment.
:::

## Notes property

This setting allows you to configure the name of the frontmatter property used to connect a note to a Jira issue in the `NOTES` column.

Example:
```
---
jira: ABCD-711
---
```

The default value is `jira`.

Notes whose title starts with the issue key are always connected, independently from this setting.

If this field is kept empty, this feature will be disabled.

[Read more...](/docs/components/jira-search)

## Default columns configuration

The default columns configuration is hardcoded in the plugin code, and it is applied when the button `Reset columns` is pressed.

| Column Name | Compact |
|-|-|
| Key | False |
| Summary | False |
| Type | True |
| Created | False |
| Updated | False |
| Reporter | False |
| Assignee | False |
| Priority | True |
| Status | False |
