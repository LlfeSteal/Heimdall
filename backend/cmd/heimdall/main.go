// Placeholder entrypoint — the backend builder wires config, GitLab client, cache and handlers here.
package main

import (
	"log"

	"heimdall/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("heimdall: root group %q (wiring pending)", cfg.RootGroup)
}
