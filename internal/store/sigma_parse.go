package store

import (
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"regexp"
	"strings"

	sigma "github.com/bradleyjkemp/sigma-go"
	"gopkg.in/yaml.v3"
)

type yamlPosition struct{ line, column int }

// The upstream parser exposes field positions but decodes numeric values through
// float64. Recover those exact scalar tokens from the YAML tree before compiling.
func parseSigmaEvidence(source string) (sigma.Rule, error) {
	var rule sigma.Rule
	if len(source) > 128*1024 {
		return rule, fmt.Errorf("rule exceeds 128 KiB")
	}
	decoder := yaml.NewDecoder(strings.NewReader(source))
	var root, extra yaml.Node
	if err := decoder.Decode(&root); err != nil {
		return rule, err
	}
	if err := decoder.Decode(&extra); err != io.EOF {
		return rule, fmt.Errorf("one YAML document per rule is required; run multiple rules as a suite")
	}
	values := map[yamlPosition][]*yaml.Node{}
	nodes := 0
	var walk func(*yaml.Node, int) error
	walk = func(node *yaml.Node, depth int) error {
		nodes++
		if nodes > 10_000 || depth > 32 {
			return fmt.Errorf("rule exceeds 10000 YAML nodes or 32 levels")
		}
		if node.Kind == yaml.AliasNode {
			return fmt.Errorf("YAML aliases and merges are unsupported; use explicit rule values")
		}
		if node.Kind == yaml.MappingNode {
			seen := map[string]bool{}
			for i := 0; i < len(node.Content); i += 2 {
				key, value := node.Content[i], node.Content[i+1]
				if key.Kind != yaml.ScalarNode || key.Tag != "!!str" || key.Value == "<<" {
					return fmt.Errorf("only explicit string mapping keys are supported (line %d)", key.Line)
				}
				if seen[key.Value] {
					return fmt.Errorf("duplicate YAML key %q on line %d", key.Value, key.Line)
				}
				seen[key.Value] = true
				list := []*yaml.Node{value}
				if value.Kind == yaml.SequenceNode {
					list = value.Content
				}
				values[yamlPosition{key.Line - 1, key.Column - 1}] = list
			}
		}
		for _, child := range node.Content {
			if err := walk(child, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	if err := walk(&root, 0); err != nil {
		return rule, err
	}
	if err := checkSigmaStructure(&root); err != nil {
		return rule, err
	}
	if err := root.Decode(&rule); err != nil {
		return rule, err
	}
	if len(rule.Detection.Searches) > 64 {
		return rule, fmt.Errorf("at most 64 named selections per rule are supported")
	}
	for name, search := range rule.Detection.Searches {
		for i, matcher := range search.EventMatchers {
			for j, field := range matcher {
				line, col := field.Position()
				original := values[yamlPosition{line, col}]
				for k, value := range original {
					if k >= len(field.Values) {
						break
					}
					if value.Tag != "!!int" && value.Tag != "!!float" {
						continue
					}
					literal := strings.ReplaceAll(value.Value, "_", "")
					if value.Tag == "!!int" {
						integer, ok := new(big.Int).SetString(literal, 0)
						if !ok {
							return rule, fmt.Errorf("unsupported integer literal on line %d", value.Line)
						}
						literal = integer.String()
					} else {
						literal = strings.TrimPrefix(literal, "+")
						if strings.HasPrefix(literal, ".") {
							literal = "0" + literal
						}
						if strings.HasPrefix(literal, "-.") {
							literal = "-0" + literal[1:]
						}
						if strings.HasSuffix(literal, ".") {
							literal += "0"
						}
					}
					if number, err := exactNumber(literal); err != nil || number == nil {
						return rule, fmt.Errorf("unsupported numeric literal on line %d: use a finite decimal within the documented limits", value.Line)
					}
					field.Values[k] = json.Number(literal)
				}
				search.EventMatchers[i][j] = field
			}
		}
		rule.Detection.Searches[name] = search
	}
	return rule, nil
}

// Guard the condition parser before recursion or float threshold decoding.
func checkSigmaStructure(root *yaml.Node) error {
	if len(root.Content) != 1 || root.Content[0].Kind != yaml.MappingNode {
		return fmt.Errorf("a rule must be a YAML mapping")
	}
	top := root.Content[0]
	for i := 0; i < len(top.Content); i += 2 {
		if top.Content[i].Value != "detection" {
			continue
		}
		detection := top.Content[i+1]
		if detection.Kind != yaml.MappingNode {
			return fmt.Errorf("detection must be a mapping")
		}
		for j := 0; j < len(detection.Content); j += 2 {
			key, value := detection.Content[j], detection.Content[j+1]
			if key.Value == "timeframe" {
				return fmt.Errorf("timeframe rules are unsupported; use a bounded sequence hunt for observed event order")
			}
			if key.Value != "condition" {
				continue
			}
			conditions := []*yaml.Node{value}
			if value.Kind == yaml.SequenceNode {
				conditions = value.Content
			}
			if len(conditions) > 16 {
				return fmt.Errorf("at most 16 conditions are supported")
			}
			for _, condition := range conditions {
				if condition.Kind != yaml.ScalarNode || condition.Tag != "!!str" || len(condition.Value) > 4096 {
					return fmt.Errorf("conditions must be strings of at most 4096 bytes")
				}
				text := condition.Value
				depth := 0
				for _, r := range text {
					if r == '(' {
						depth++
					}
					if r == ')' {
						depth--
					}
					if depth > 32 {
						return fmt.Errorf("condition nesting exceeds 32 levels")
					}
				}
				// Repeated operators can also produce deeply nested parser trees.
				if len(strings.Fields(text)) > 256 {
					return fmt.Errorf("condition exceeds 256 terms")
				}
				if _, tail, ok := strings.Cut(text, "|"); ok && !regexp.MustCompile(`[<>=!]=?\s*[+-]?[0-9]+\s*$`).MatchString(tail) {
					return fmt.Errorf("legacy aggregation requires an integer count threshold")
				}
			}
		}
	}
	return nil
}
