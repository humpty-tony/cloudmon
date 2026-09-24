# Local labels

Draft scope: add, rename and remove personal labels for exact account IDs, full ARNs and recorded source addresses. Display labels alongside original identifiers in event inspection, activity analysis and investigation/lineage context. Keep searches, exports, correlation and original records unchanged.

Labels are local preferences, bounded and validated; save failures must remain visible. ARN/account handling follows AWS [ARN formats](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html) and [account identifiers](https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-identifiers.html). No account discovery or AWS calls are introduced.

Validation: focused persistence/error checks, browser label/edit/pivot behavior and screenshots, plus Linux/Windows/macOS CI builds.
