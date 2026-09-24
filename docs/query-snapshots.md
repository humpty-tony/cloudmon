# Consistent query snapshots and complete export

This change group will make initial results and summaries share a committed snapshot, keep pagination stable during capture, cancel superseded searches, and export every matching source record beyond the UI's loaded-row limit. It builds on the inspector and search-correctness groups.
