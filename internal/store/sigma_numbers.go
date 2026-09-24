package store

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

var exactNumberPattern = regexp.MustCompile(`^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$`)

func exactNumber(value string) (*big.Rat, error) {
	if len(value) > 4096 {
		return nil, fmt.Errorf("numeric value exceeds 4096 characters")
	}
	if !exactNumberPattern.MatchString(value) {
		return nil, nil
	}
	if i := strings.IndexAny(value, "eE"); i >= 0 {
		exponent, err := strconv.Atoi(value[i+1:])
		if err != nil || exponent < -4096 || exponent > 4096 {
			return nil, fmt.Errorf("numeric exponent exceeds the supported ±4096 range")
		}
	}
	number, ok := new(big.Rat).SetString(value)
	if !ok {
		return nil, fmt.Errorf("cannot read exact numeric value")
	}
	return number, nil
}

// DuckDB's JSON string extraction can round decimal tokens. Numeric predicates
// therefore read the original source with UseNumber, without a float64 hop.
// Duplicate object members and traversal limits fail the whole query explicitly.
func readNumberEvidence(decoder *json.Decoder, depth int, nodes *int) (any, error) {
	*nodes++
	if depth > 64 || *nodes > 50_000 {
		return nil, fmt.Errorf("numeric evidence traversal exceeds 64 levels or 50000 values")
	}
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return token, nil
	}
	switch delim {
	case '{':
		object := map[string]any{}
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return nil, err
			}
			name, ok := key.(string)
			if !ok {
				return nil, fmt.Errorf("invalid object key")
			}
			if _, exists := object[name]; exists {
				return nil, fmt.Errorf("duplicate JSON member %q makes numeric evidence ambiguous", name)
			}
			value, err := readNumberEvidence(decoder, depth+1, nodes)
			if err != nil {
				return nil, err
			}
			object[name] = value
		}
		_, err = decoder.Token()
		return object, err
	case '[':
		array := []any{}
		for decoder.More() {
			value, err := readNumberEvidence(decoder, depth+1, nodes)
			if err != nil {
				return nil, err
			}
			array = append(array, value)
		}
		_, err = decoder.Token()
		return array, err
	}
	return nil, fmt.Errorf("unexpected JSON delimiter")
}
func numberField(value any, path []string, resourceArray bool) []any {
	if len(path) == 0 {
		return []any{value}
	}
	if array, ok := value.([]any); ok && resourceArray {
		out := []any{}
		for _, element := range array {
			out = append(out, numberField(element, path, false)...)
		}
		return out
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	child, ok := object[path[0]]
	if !ok {
		return nil
	}
	return numberField(child, path[1:], resourceArray)
}
func matchExactNumber(values []driver.Value) (any, error) {
	raw, field, literal, op := values[0].(string), values[1].(string), values[2].(string), values[3].(string)
	if len(raw) > 8_000_000 {
		return nil, fmt.Errorf("numeric predicates support original records up to 8 million bytes")
	}
	threshold, err := exactNumber(literal)
	if err != nil {
		return nil, err
	}
	if threshold == nil {
		return nil, fmt.Errorf("numeric predicate needs a finite decimal")
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	nodes := 0
	root, err := readNumberEvidence(decoder, 0, &nodes)
	if err != nil {
		return nil, err
	}
	for _, value := range numberField(root, strings.Split(field, "."), strings.HasPrefix(field, "resources.")) {
		var text string
		switch v := value.(type) {
		case json.Number:
			text = string(v)
		case string:
			text = v
		default:
			continue
		}
		number, err := exactNumber(text)
		if err != nil {
			return nil, err
		}
		if number == nil {
			continue
		}
		cmp := number.Cmp(threshold)
		if op == "eq" && cmp == 0 || op == "gt" && cmp > 0 || op == "gte" && cmp >= 0 || op == "lt" && cmp < 0 || op == "lte" && cmp <= 0 {
			return true, nil
		}
	}
	return false, nil
}

func numericPredicate(field, op, literal string) (string, error) {
	number, err := exactNumber(literal)
	if err != nil {
		return "", err
	}
	if number == nil {
		return "", fmt.Errorf("numeric comparison needs a finite decimal, got %q", literal)
	}
	if op == "" {
		op = "eq"
	}
	return "cloudmon_numeric_match(raw," + sqlStr(field) + "," + sqlStr(literal) + "," + sqlStr(op) + ")", nil
}
