# Example suite for the JUnit reader's tests: generate.sh runs it with Pester's
# JUnit output. Some tests fail or are skipped on purpose.

Describe 'Audit' {
    It 'reads the audit log @pester.audit' {
        1 + 1 | Should -Be 2
    }

    It 'writes the report @pester.report' {
        'draft' | Should -Be 'final'
    }

    It 'audits a remote computer @pester.remote' -Skip {
        $true | Should -BeTrue
    }
}

Describe 'Inventory' {
    It 'lists the installed software' {
        @('a', 'b') | Should -HaveCount 2
    }
}
