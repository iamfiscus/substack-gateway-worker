Feature: Runner self-test

  Scenario: Steps run with parsed arguments
    Given a counter at 2
    When I add "3"
    Then the counter is 5

  Scenario: A skipped scenario never runs
    Given a step nobody defines
    Then nothing happens
