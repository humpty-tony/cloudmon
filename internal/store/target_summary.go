package store

// Window-only display projection. Keep raw evidence out of the row transport and
// avoid a storage migration: old saved evidence gains targets on its next read.
// These are bounded recorded strings, not resource correlation keys or filters.
const targetSummarySQL = `left(coalesce(
 CASE WHEN json_type(raw,'$.requestParameters.secretId')='VARCHAR' THEN nullif(json_extract_string(raw,'$.requestParameters.secretId'),'') END,
 CASE WHEN json_type(raw,'$.requestParameters.bucketName')='VARCHAR' THEN nullif(json_extract_string(raw,'$.requestParameters.bucketName'),'') || CASE WHEN json_type(raw,'$.requestParameters.key')='VARCHAR' THEN '/' || json_extract_string(raw,'$.requestParameters.key') ELSE '' END END,
 CASE WHEN json_type(raw,'$.resources[0].ARN')='VARCHAR' THEN nullif(json_extract_string(raw,'$.resources[0].ARN'),'') END,
 CASE WHEN json_type(raw,'$.requestParameters.roleArn')='VARCHAR' THEN nullif(json_extract_string(raw,'$.requestParameters.roleArn'),'') END,
 CASE WHEN json_type(raw,'$.requestParameters.roleName')='VARCHAR' THEN nullif(json_extract_string(raw,'$.requestParameters.roleName'),'') END,
 CASE WHEN json_type(raw,'$.requestParameters.policyArn')='VARCHAR' THEN nullif(json_extract_string(raw,'$.requestParameters.policyArn'),'') END,
 CASE WHEN json_type(raw,'$.requestParameters.instanceId')='VARCHAR' THEN nullif(json_extract_string(raw,'$.requestParameters.instanceId'),'') END,
 CASE WHEN json_type(raw,'$.requestParameters.instancesSet.items[0].instanceId')='VARCHAR' THEN nullif(json_extract_string(raw,'$.requestParameters.instancesSet.items[0].instanceId'),'') END,
 CASE WHEN json_type(raw,'$.requestParameters.keyId')='VARCHAR' THEN nullif(json_extract_string(raw,'$.requestParameters.keyId'),'') END,
 CASE WHEN json_type(raw,'$.requestParameters.functionName')='VARCHAR' THEN nullif(json_extract_string(raw,'$.requestParameters.functionName'),'') END,
 CASE WHEN json_type(raw,'$.requestParameters.resourceArn')='VARCHAR' THEN nullif(json_extract_string(raw,'$.requestParameters.resourceArn'),'') END,
 CASE WHEN json_type(raw,'$.requestParameters.tableName')='VARCHAR' THEN nullif(json_extract_string(raw,'$.requestParameters.tableName'),'') END,
 ''),512)`

const displayCols = pageCols + "," + targetSummarySQL + " AS target"
