# Event workbench

The default event view uses three stable panes: filters, a virtualized list, and a persistent inspector. Selecting a row changes the inspector without expanding or resizing the row. Clicking the selected row keeps it open. Close inspector or Escape clears the selection; keyboard focus returns to the event list after Escape.

The Workbench column preset shows time, action/principal, and result. Other presets, column selection, resizing, and reorder remain available. Workbench columns and histogram visibility use new preference keys so older table preferences are retained rather than overwritten. Filters can be hidden, and the histogram starts collapsed. Counts remain visible beside the results instead of occupying a separate strip of large tiles.

## Investigation

- Fields uses the existing lossless worker and virtualized field tree. Switching tabs preserves expanded fields.
- Original JSON displays retained source text in bounded segments. Open full JSON provides the existing copy/source modal.
- Lineage contains the credential chain and opens the full graph.
- Investigate, Sources & hashes, and comparison pins remain available beside the event list.

Every selected event captures one evidence snapshot before its raw record and lineage are fetched. Retries and investigation/source/graph navigation retain that snapshot. Live arrivals do not change the selected scope. A newer selection, closing the inspector, or replacing the dataset invalidates pending detail responses. A successful search clears the inspector if the selected event is no longer in the returned page; failed searches keep the previous evidence visible with the existing failure notice.

Arrow keys and j/k in the event list select and inspect adjacent rows. Enter/o also pauses following before inspection. Search inputs, inspector fields, tabs, buttons, and modal dialogs retain their own keyboard behavior. Live capture and the explicit Follow action remain separate from selecting evidence.

## Validation

The browser scenarios cover stable row geometry, selection/close, keyboard navigation, independent pane scrolling, retained snapshots, exact large numbers/source text, retry/cancellation, and 960/1440 light/dark layouts. The performance fixture uses the actual inspector with 20,000 virtualized rows and checks bounded row-key work on scrolling, selection, and unrelated updates. Machine timings are observations rather than portable latency guarantees.

This change does not alter AWS capture permissions or release tagging. v0.2.2 points to the preceding merged responsiveness fixes; the Workbench redesign is a separate review branch.
