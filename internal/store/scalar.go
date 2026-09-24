package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/netip"
	"strings"

	"github.com/duckdb/duckdb-go/v2"
)

// Native Go callbacks avoid downloading extensions and use the same address
// parser on every platform. They are registered in the database's live catalog.
type evidenceScalar struct {
	config duckdb.ScalarFuncConfig
	run    duckdb.RowExecutorFn
}

func (f *evidenceScalar) Config() duckdb.ScalarFuncConfig { return f.config }
func (f *evidenceScalar) Executor() duckdb.ScalarFuncExecutor {
	return duckdb.ScalarFuncExecutor{RowExecutor: f.run}
}

func networkPrefix(value string) (netip.Prefix, error) {
	if strings.Contains(value, "/") {
		return netip.ParsePrefix(value)
	}
	ip, err := netip.ParseAddr(value)
	if err != nil || ip.Zone() != "" {
		return netip.Prefix{}, fmt.Errorf("expected an IP address or CIDR network")
	}
	return netip.PrefixFrom(ip, ip.BitLen()), nil
}
func matchNetwork(values []driver.Value) (any, error) {
	ip, err := netip.ParseAddr(values[0].(string))
	if err != nil || ip.Zone() != "" {
		return false, nil
	}
	network, err := networkPrefix(values[1].(string))
	if err != nil {
		return false, err
	}
	return network.Contains(ip), nil
}
func registerEvidenceFunctions(ctx context.Context, db *sql.DB) error {
	text, err := duckdb.NewTypeInfo(duckdb.TYPE_VARCHAR)
	if err != nil {
		return err
	}
	boolean, err := duckdb.NewTypeInfo(duckdb.TYPE_BOOLEAN)
	if err != nil {
		return err
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if err = duckdb.RegisterScalarUDF(conn, "cloudmon_ip_match", &evidenceScalar{config: duckdb.ScalarFuncConfig{InputTypeInfos: []duckdb.TypeInfo{text, text}, ResultTypeInfo: boolean}, run: matchNetwork}); err != nil {
		return err
	}
	return duckdb.RegisterScalarUDF(conn, "cloudmon_numeric_match", &evidenceScalar{config: duckdb.ScalarFuncConfig{InputTypeInfos: []duckdb.TypeInfo{text, text, text, text}, ResultTypeInfo: boolean}, run: matchExactNumber})
}
