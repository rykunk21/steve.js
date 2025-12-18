# Requirements Document

## Introduction

This feature involves creating a Discord bot that provides custom slash commands for two main server functionalities: Gaming and Gambling. The gambling functionality focuses on sports betting discussions through an admin-controlled system that uses ESPN's Core API for game schedules and HTML scraping for betting information. Admins can select games from a daily log to create dedicated betting threads with live odds updates. The gaming functionality enables users to create private gaming lobbies with dedicated voice channels for coordinated gameplay sessions.

## Requirements

### Requirement 1

**User Story:** As a server administrator, I want to review and select games from a daily game log, so that I can control which games get betting threads in my server.

#### Acceptance Criteria

1. WHEN the bot runs its daily schedule update THEN the system SHALL fetch game data from ESPN API for NFL, NCAA Football, NHL, NBA, and NCAA Basketball
2. WHEN fetching NCAA Basketball games THEN the system SHALL use the ESPN Scoreboard API to retrieve all Division I games without pagination limits
3. WHEN games are found THEN the system SHALL populate a daily game log with detailed game information including teams, team abbreviations, venues, and times
4. WHEN an administrator reviews the game log THEN the system SHALL display formatted game details with team names, locations, and tip-off times
5. WHEN an administrator selects a game THEN the system SHALL create a dedicated betting thread in the configured gambling channel
6. IF no games are selected by administrators THEN the system SHALL NOT create any threads automatically

### Requirement 1A

**User Story:** As a server administrator, I want interactive toggle buttons for betting thread management, so that I can easily create and delete betting threads with visual feedback.

#### Acceptance Criteria

1. WHEN a game is displayed in the daily log THEN the system SHALL show a green "Create Thread" button if no betting thread exists
2. WHEN I click the "Create Thread" button THEN the system SHALL create a betting thread AND change the button to red with "Delete Thread" text
3. WHEN a betting thread exists for a game THEN the system SHALL display a red "Delete Thread" button
4. WHEN I click the "Delete Thread" button THEN the system SHALL remove the betting thread AND change the button back to green with "Create Thread" text
5. WHEN button states change THEN the system SHALL update the message embed immediately to reflect the current state

### Requirement 2

**User Story:** As a server member, I want to see live betting information in game threads, so that I can make informed betting decisions and track line movements.

#### Acceptance Criteria

1. WHEN a betting thread is created THEN the system SHALL scrape and display current betting lines and odds from ActionNetwork using browser automation
2. WHEN betting data is scraped THEN the system SHALL match ActionNetwork games to ESPN games using team abbreviations and aliases
3. WHEN team matching fails THEN the system SHALL log detailed diagnostic information including team names from both sources
4. WHEN betting lines are updated THEN the system SHALL refresh the thread with new odds information multiple times daily
5. WHEN odds change significantly THEN the system SHALL highlight the movement in the thread
6. WHEN a game starts THEN the system SHALL mark the thread as live and continue updating with ESPN API game status
7. WHEN a game ends THEN the system SHALL post final results from ESPN API and close betting line updates

### Requirement 2A

**User Story:** As a server member, I want to see comprehensive betting line data for all sports, so that I can access moneyline, spread, and totals information.

#### Acceptance Criteria

1. WHEN betting lines are scraped THEN the system SHALL use browser automation to navigate ActionNetwork's dynamic betting market selectors
2. WHEN scraping betting data THEN the system SHALL interact with the market dropdown to select "Spread", "Total", "Moneyline", and "All Markets" options sequentially
3. WHEN each market is selected THEN the system SHALL wait for the odds table to update and capture the displayed betting data
4. WHEN betting lines are scraped THEN the system SHALL capture point spread and spread odds for NFL, NBA, NCAA Basketball, and NCAA Football from the spread market view
5. WHEN betting lines are scraped THEN the system SHALL capture puck line and puck line odds for NHL games from the spread market view (instead of point spread)
6. WHEN betting lines are scraped THEN the system SHALL capture moneyline odds for both teams from the moneyline market view
7. WHEN betting lines are scraped THEN the system SHALL capture over/under totals and corresponding odds from the total market view
8. WHEN betting data is unavailable THEN the system SHALL display appropriate fallback messages and continue monitoring

### Requirement 2B

**User Story:** As a server member, I want to see betting line movements tracked over time, so that I can analyze trends and make informed decisions.

#### Acceptance Criteria

1. WHEN betting lines are scraped THEN the system SHALL store each snapshot permanently in the database with timestamp
2. WHEN lines move THEN the system SHALL create new database records to track the complete movement history
3. WHEN displaying current odds THEN the system SHALL show directional indicators for recent line movements
4. WHEN significant movements occur THEN the system SHALL highlight the changes with visual indicators
5. WHEN historical data is requested THEN the system SHALL maintain all betting snapshots for future analytics modeling

### Requirement 2B1

**User Story:** As a server member, I want betting thread titles to clearly identify the matchup and spread, so that I can quickly scan available games.

#### Acceptance Criteria

1. WHEN a betting thread is created THEN the system SHALL set the thread title in the format "[Away Abbrev] @ [Home Abbrev] | [Favorite] -[Spread]"
2. WHEN the home team is favored THEN the system SHALL display the spread as "[Home Abbrev] -[Spread Value]" (e.g., "FLA @ ARIZ | ARIZ -3.5")
3. WHEN the away team is favored THEN the system SHALL display the spread as "[Away Abbrev] -[Spread Value]" (e.g., "DUKE @ UNC | DUKE -2.5")
4. WHEN the game is a pick'em THEN the system SHALL display "PICK'EM" instead of a spread value
5. WHEN spread data is unavailable THEN the system SHALL display "[Away Abbrev] @ [Home Abbrev] | Odds Pending"

### Requirement 2C

**User Story:** As a server member, I want to see spread information visually displayed in betting threads, so that I can instantly understand who is favored and by how much.

#### Acceptance Criteria

1. WHEN a betting thread is created THEN the system SHALL display a visual spread bar in the first message using Discord emoji squares
2. WHEN rendering the spread bar THEN the system SHALL use exactly 16 emoji squares total to fit on one line in iOS Discord
3. WHEN calculating the spread bar distribution THEN the system SHALL map the point spread to a proportional split of the 16 squares between away and home teams
4. WHEN the spread is 0 (pick'em) THEN the system SHALL display 8 squares for each team (50/50 split)
5. WHEN the spread heavily favors one team THEN the system SHALL use exponential scaling to allow extreme splits (e.g., 15-1 for very large spreads)
6. WHEN rendering emoji squares THEN the system SHALL use each team's primary color to create colored square emojis (e.g., :red_square:, :blue_square:)
7. WHEN the spread changes THEN the system SHALL update the first message to reflect the new spread bar distribution
8. WHEN spread data is unavailable THEN the system SHALL display a neutral gray bar with "Odds Pending" text

### Requirement 2C1

**User Story:** As a developer, I want to map team identifiers to their primary colors, so that the visual spread bar displays team-specific colors accurately.

#### Acceptance Criteria

1. WHEN extracting team data from ESPN THEN the system SHALL capture the team's primary color hex code
2. WHEN a team's primary color is unavailable from ESPN THEN the system SHALL use a predefined color mapping for common teams
3. WHEN mapping colors to Discord emojis THEN the system SHALL select the closest available Discord color square emoji (red, orange, yellow, green, blue, purple, brown, white, black)
4. WHEN two teams have similar primary colors THEN the system SHALL select contrasting emoji colors to ensure visual distinction
5. WHEN a team color cannot be determined THEN the system SHALL use a default color (blue for away, red for home)

### Requirement 2C2

**User Story:** As a server administrator, I want to manually set team colors for spread bars by reacting to team betting embeds, so that I can correct inaccurate automatic color selections.

#### Acceptance Criteria

1. WHEN a betting thread is created THEN the system SHALL send two separate embeds showing betting information for each team
2. WHEN displaying team betting embeds THEN the system SHALL show moneyline odds, spread with odds, and over/under for each team
3. WHEN displaying the favorite team embed THEN the system SHALL show the "Over" total odds
4. WHEN displaying the underdog team embed THEN the system SHALL show the "Under" total odds
5. WHEN an administrator reacts to a team embed with a color square emoji THEN the system SHALL update that team's color server-wide
6. WHEN a team color is changed via reaction THEN the system SHALL immediately edit the spread bar message with the new color
7. WHEN a team color is changed via reaction THEN the system SHALL remove the administrator's reaction and send an ephemeral confirmation message
8. WHEN a team has a manual color override THEN the system SHALL use the override for all future betting threads with that team
9. WHEN betting threads are created THEN the system SHALL use automatic color detection from TeamColorMapper as the initial color

### Requirement 2D

**User Story:** As a server member, I want detailed betting information displayed when I open a thread, so that I can access complete odds data, line history, and a recommended pick.

#### Acceptance Criteria

1. WHEN I open a betting thread THEN the system SHALL display a formatted embed message as the first message in the thread
2. WHEN displaying betting data THEN the system SHALL show game information including full team names, game time, and venue
3. WHEN displaying betting data THEN the system SHALL show current spread with odds for both teams in the format "[Team] [+/-Spread] ([Odds])"
4. WHEN displaying betting data THEN the system SHALL show current moneyline odds for both teams in the format "[Team] [+/-Odds]"
5. WHEN displaying betting data THEN the system SHALL show current over/under total with odds in the format "O [Total] ([Odds]) / U [Total] ([Odds])"
6. WHEN displaying betting data THEN the system SHALL include a "Recommended Pick" section that identifies the best betting opportunity
7. WHEN line movement history exists THEN the system SHALL display the previous spread value and direction of movement (e.g., "Was: ARIZ -4.5 → Now: ARIZ -3.5")
8. WHEN odds are stale or unavailable THEN the system SHALL display "Odds data unavailable" with the last update timestamp
9. WHEN the embed is displayed THEN the system SHALL use team colors for visual distinction and include team logos

### Requirement 2E

**User Story:** As a server member, I want the system to recommend the best betting opportunity using statistical simulation, so that I can identify value bets with positive expected value.

#### Acceptance Criteria

1. WHEN calculating a recommended pick THEN the system SHALL run a Markov Chain Monte Carlo simulation for each game to estimate true win probabilities
2. WHEN running MCMC simulation THEN the system SHALL use team statistics from ESPN database to build game-specific transition probability matrices
3. WHEN building transition matrices THEN the system SHALL incorporate team-specific metrics including offensive efficiency, defensive efficiency, pace, and recent performance
4. WHEN simulating game outcomes THEN the system SHALL run at least 10,000 Monte Carlo iterations per game to ensure statistical reliability
5. WHEN evaluating betting opportunities THEN the system SHALL compare simulated probabilities against implied probabilities from betting odds
6. WHEN calculating implied probability THEN the system SHALL convert American odds to probability using the standard formula (e.g., -200 = 66.7% implied probability)
7. WHEN simulated probability exceeds implied probability by 5% or more THEN the system SHALL identify this as a positive expected value opportunity
8. WHEN displaying recommendations THEN the system SHALL show the bet type, simulated probability, implied probability, and expected value percentage
9. WHEN multiple positive EV opportunities exist THEN the system SHALL recommend the bet with the highest expected value
10. WHEN no positive EV opportunities exist THEN the system SHALL display "No value opportunities detected - all bets priced efficiently"
11. WHEN team statistics are insufficient THEN the system SHALL fall back to line movement analysis for recommendations

### Requirement 3

**User Story:** As a server member, I want to create private gaming lobbies with voice channels, so that I can organize gaming sessions with specific people.

#### Acceptance Criteria

1. WHEN a user executes the create lobby slash command THEN the system SHALL create a new private voice channel
2. WHEN a lobby is created THEN the system SHALL assign the command executor as the party leader
3. WHEN a lobby is created THEN the system SHALL provide invite functionality for the party leader
4. WHEN users are invited to a lobby THEN the system SHALL grant them access to the private voice channel
5. WHEN a lobby is empty for a specified duration THEN the system SHALL automatically delete the voice channel

### Requirement 4

**User Story:** As a party leader, I want to manage my gaming lobby membership, so that I can control who participates in my gaming session.

#### Acceptance Criteria

1. WHEN I am a party leader THEN the system SHALL allow me to invite specific users to my lobby
2. WHEN I am a party leader THEN the system SHALL allow me to remove users from my lobby
3. WHEN I am a party leader THEN the system SHALL allow me to transfer leadership to another member
4. WHEN I am a party leader THEN the system SHALL allow me to disband the lobby
5. IF I leave the lobby THEN the system SHALL automatically transfer leadership to another member or disband if empty

### Requirement 5

**User Story:** As a server administrator, I want to configure the bot's gambling and gaming behavior, so that I can customize how it operates in my server.

#### Acceptance Criteria

1. WHEN I have administrator permissions THEN the system SHALL allow me to designate a gambling channel for betting threads
2. WHEN I configure the gambling channel THEN the system SHALL only create betting threads in the designated channel
3. WHEN I configure the bot THEN the system SHALL allow me to set lobby duration limits and permissions
4. WHEN I configure betting updates THEN the system SHALL allow me to customize the frequency of odds refreshes
5. IF configuration is invalid THEN the system SHALL provide clear error messages and guidance

### Requirement 6

**User Story:** As a server member, I want to receive notifications about gaming lobbies and betting threads, so that I don't miss opportunities to participate.

#### Acceptance Criteria

1. WHEN a new betting thread is created THEN the system SHALL optionally notify subscribed users
2. WHEN I am invited to a gaming lobby THEN the system SHALL send me a direct notification
3. WHEN significant line movements occur THEN the system SHALL notify interested users if they've opted in
4. WHEN game results are available THEN the system SHALL update the relevant threads with final outcomes
5. IF I want to stop notifications THEN the system SHALL provide an opt-out mechanism

### Requirement 7

**User Story:** As a server member, I want the bot to handle errors gracefully, so that my experience isn't disrupted by technical issues.

#### Acceptance Criteria

1. WHEN ESPN API calls fail THEN the system SHALL retry with exponential backoff and use cached data as fallback
2. WHEN sports schedule data is unavailable THEN the system SHALL inform administrators and continue operating with cached data
3. WHEN voice channel creation fails THEN the system SHALL notify the user and suggest alternatives
4. WHEN the bot loses permissions THEN the system SHALL log the issue and notify administrators
5. IF the bot encounters an unexpected error THEN the system SHALL log details for debugging while maintaining user privacy

### Requirement 8

**User Story:** As a developer, I want comprehensive data extraction and matching capabilities, so that betting threads can be created reliably for all games.

#### Acceptance Criteria

1. WHEN extracting game data from ESPN THEN the system SHALL capture team IDs, full names, abbreviations, and logos for both home and away teams
2. WHEN scraping ActionNetwork THEN the system SHALL extract all games displayed on the sport-specific odds page using browser automation
3. WHEN ActionNetwork displays team information THEN the system SHALL parse both team names and abbreviations from the combined text format
4. WHEN matching ESPN games to ActionNetwork odds THEN the system SHALL use a multi-strategy approach including abbreviation matching, alias resolution, and normalized name comparison
5. WHEN a match cannot be found THEN the system SHALL log both ESPN and ActionNetwork team identifiers for diagnostic purposes
6. WHEN team aliases are insufficient THEN the system SHALL support adding new aliases to improve future matching
7. WHEN home and away teams are reversed between sources THEN the system SHALL detect the reversal and adjust spread signs accordingly

### Requirement 9

**User Story:** As a developer, I want a robust team name matching system, so that ESPN games can be reliably matched to Action Network odds despite naming differences.

#### Acceptance Criteria

1. WHEN matching team names THEN the system SHALL normalize both ESPN and Action Network names by converting to lowercase, removing special characters, and trimming whitespace
2. WHEN calculating similarity THEN the system SHALL use Levenshtein distance algorithm to measure string similarity between 0.0 and 1.0
3. WHEN comparing games THEN the system SHALL require both away and home teams to match with confidence greater than 0.7
4. WHEN multiple Action Network games could match THEN the system SHALL select the game with the highest combined similarity score
5. WHEN a match is found THEN the system SHALL mark both games as matched to prevent duplicate matching
6. WHEN no match exceeds the confidence threshold THEN the system SHALL log the failed match with team names from both sources for debugging
7. WHEN matching completes THEN the system SHALL return matched game pairs with confidence scores for monitoring match quality

### Requirement 10

**User Story:** As a data scientist, I want to access historical game data for model training, so that the betting model can learn from past performance patterns.

#### Acceptance Criteria

1. WHEN training the model THEN the system SHALL fetch historical game IDs from StatBroadcast schedule endpoint using team GIDs
2. WHEN fetching game IDs THEN the system SHALL query https://www.statbroadcast.com/events/schedule.php?gid={statbroadcast_gid} for each team
3. WHEN game IDs are retrieved THEN the system SHALL fetch XML data from http://archive.statbroadcast.com/{gameId}.xml
4. WHEN processing games THEN the system SHALL extract transition probabilities on-the-fly without persisting raw game data
5. WHEN computing team features THEN the system SHALL aggregate statistics across multiple games to build feature vectors
6. WHEN storing team data THEN the system SHALL persist only the computed feature vectors in teams.statistical_representation field
7. WHEN model validation is needed THEN the system SHALL re-fetch and re-process games from StatBroadcast archives

### Requirement 11

**User Story:** As a data scientist, I want a stable VAE-Neural Network system with InfoNCE pretraining and Bayesian posterior updates for team encoding and transition probability prediction, so that the model learns rich team representations without mode collapse and adapts continuously from observed game outcomes.

#### Acceptance Criteria

1. WHEN the system initializes THEN the system SHALL load frozen VAE encoder weights, NN weights, and team posterior latent distributions from the database
2. WHEN pretraining the VAE THEN the system SHALL train the encoder with reconstruction loss + KL divergence + λ * InfoNCE(z, g(y)) to create label-predictive latent representations
3. WHEN pretraining completes THEN the system SHALL freeze the VAE encoder weights permanently to preserve InfoNCE structure
4. WHEN extracting team features THEN the system SHALL normalize game features (shooting stats, rebounding, assists, turnovers, advanced metrics, player-level data) to [0,1] range before VAE input
5. WHEN encoding teams THEN the system SHALL use the frozen VAE encoder to map normalized game features (80-dim) to latent team distributions N(μ, σ²) with 16 dimensions
6. WHEN retrieving team representations THEN the system SHALL load current posterior latent distributions (mean and variance) from the database for each team
7. WHEN building game representations THEN the system SHALL concatenate team A posterior latent (μ, σ), team B posterior latent (μ, σ), and game context features into input vector
8. WHEN generating transition probabilities THEN the system SHALL use a neural network to map game representations to predicted transition probability matrices (8 outcomes)
9. WHEN a game completes THEN the system SHALL compute actual transition probabilities from play-by-play data as ground truth targets
10. WHEN updating the neural network THEN the system SHALL calculate cross-entropy loss between predicted and actual transition probabilities and perform gradient descent on NN weights only
11. WHEN updating team representations THEN the system SHALL apply Bayesian posterior updates to team latent distributions (μ, σ) based on observed game performance without backpropagating through the frozen encoder
12. WHEN performing Bayesian updates THEN the system SHALL treat game outcomes as observations and update posterior distributions using p(z|games) ∝ p(y|z,opponent,context) p(z)
13. WHEN a new season begins THEN the system SHALL increase team uncertainty by adding inter-year variance to σ² values to account for roster changes, coaching changes, and reduced predictive value of historical performance
14. WHEN calculating inter-year uncertainty increase THEN the system SHALL add a configurable variance increment (default 0.25) to each dimension's σ² at season start
15. WHEN storing team data THEN the system SHALL persist updated posterior latent distributions (μ, σ) in teams.statistical_representation field as JSON with season tracking
16. WHEN displaying predictions THEN the system SHALL indicate data source (VAE-NN system vs fallback methods) and confidence levels

### Requirement 12

**User Story:** As a data scientist, I want opponent-adjusted performance metrics, so that team strength is measured relative to competition quality rather than raw statistics.

#### Acceptance Criteria

1. WHEN calculating team metrics THEN the system SHALL adjust offensive and defensive ratings based on the strength of opponents faced
2. WHEN a team plays a strong opponent THEN the system SHALL weight their performance more heavily than games against weak opponents
3. WHEN computing strength of schedule THEN the system SHALL use iterative algorithms to solve for true team ratings accounting for opponent quality
4. WHEN displaying team statistics THEN the system SHALL show both raw metrics and opponent-adjusted metrics for comparison
5. WHEN building transition matrices THEN the system SHALL use opponent-adjusted metrics rather than raw season averages
6. WHEN the season progresses THEN the system SHALL continuously update opponent adjustments as more games provide better estimates of team strength
7. WHEN comparing teams THEN the system SHALL account for differences in schedule difficulty when projecting head-to-head matchups

### Requirement 13

**User Story:** As a data scientist, I want possession-level modeling with play-by-play data from StatBroadcast, so that game simulations reflect realistic scoring patterns and the generative model learns from actual game flow.

#### Acceptance Criteria

1. WHEN connecting to StatBroadcast THEN the system SHALL establish a connection manager to https://www.statbroadcast.com/events/index.php for NCAA game data
2. WHEN crawling StatBroadcast THEN the system SHALL learn the site structure and provide capability to search for schools and discover available games
3. WHEN retrieving live game data THEN the system SHALL monitor scheduled games and stream real-time play-by-play updates during active games
4. WHEN parsing play-by-play data THEN the system SHALL extract individual possession outcomes including shot type (2pt/3pt/FT), result (make/miss), rebounds, turnovers, and game context
5. WHEN computing ground truth transition probabilities THEN the system SHALL derive possession-level probabilities from actual play-by-play sequences for model training
6. WHEN training the generative model THEN the system SHALL use play-by-play derived transition probabilities as target outputs for the MLP
7. WHEN simulating possessions THEN the system SHALL use MLP-generated transition probabilities that reflect learned patterns from historical play-by-play data
8. WHEN simulating possessions THEN the system SHALL account for offensive rebounds and second-chance opportunities through transition probability states
9. WHEN simulating possessions THEN the system SHALL model turnover rates and defensive stops through transition probability states
10. WHEN updating the generative model THEN the system SHALL use real-time play-by-play data to compute actual transition probabilities for online learning
11. WHEN play-by-play data is unavailable THEN the system SHALL fall back to aggregate statistics with appropriate uncertainty adjustments
12. WHEN displaying simulation results THEN the system SHALL show the data source used (StatBroadcast play-by-play vs ESPN aggregate) and confidence level
13. WHEN storing play-by-play data THEN the system SHALL NOT persist raw data locally but SHALL extract transition probabilities for model training

### Requirement 14

**User Story:** As a data scientist, I want feature engineering for contextual factors, so that predictions account for injuries, rest, travel, and other situational variables.

#### Acceptance Criteria

1. WHEN generating predictions THEN the system SHALL incorporate rest days as a feature affecting team performance
2. WHEN teams play back-to-back games THEN the system SHALL apply fatigue adjustments to offensive and defensive efficiency
3. WHEN teams travel across time zones THEN the system SHALL account for travel fatigue in the prediction model
4. WHEN injury reports are available THEN the system SHALL adjust team strength based on missing players and their historical impact
5. WHEN key players are injured THEN the system SHALL reduce team offensive or defensive ratings proportional to the player's contribution
6. WHEN displaying predictions THEN the system SHALL list the contextual factors considered and their estimated impact
7. WHEN contextual data is unavailable THEN the system SHALL proceed with base predictions and note the missing factors

### Requirement 15

**User Story:** As a data scientist, I want model validation and backtesting capabilities, so that I can measure prediction accuracy and calibrate the betting model.

#### Acceptance Criteria

1. WHEN the model makes predictions THEN the system SHALL store the predicted probabilities alongside the actual outcomes for validation
2. WHEN evaluating model performance THEN the system SHALL calculate calibration metrics including Brier score and log loss
3. WHEN backtesting THEN the system SHALL simulate betting on historical games using only information available at prediction time
4. WHEN backtesting completes THEN the system SHALL report return on investment, win rate, and profit/loss for different betting strategies
5. WHEN calibration issues are detected THEN the system SHALL identify which types of games or situations have poor prediction accuracy
6. WHEN displaying model performance THEN the system SHALL show calibration plots comparing predicted probabilities to actual outcomes
7. WHEN the model is updated THEN the system SHALL re-run validation tests to ensure improvements are genuine and not overfitting

### Requirement 16

**User Story:** As a data scientist, I want ensemble methods combining multiple models, so that predictions are robust and less sensitive to individual model weaknesses.

#### Acceptance Criteria

1. WHEN generating predictions THEN the system SHALL run multiple independent models including MCMC simulation, regression models, and machine learning approaches
2. WHEN combining model outputs THEN the system SHALL use weighted averaging based on each model's historical accuracy
3. WHEN models disagree significantly THEN the system SHALL flag high-uncertainty predictions and recommend caution
4. WHEN one model performs poorly THEN the system SHALL automatically reduce its weight in the ensemble
5. WHEN displaying predictions THEN the system SHALL show the consensus prediction and the range of individual model predictions
6. WHEN evaluating ensemble performance THEN the system SHALL demonstrate that the ensemble outperforms individual models on validation data
7. WHEN adding new models THEN the system SHALL integrate them into the ensemble and evaluate their contribution to prediction accuracy

### Requirement 17

**User Story:** As a developer, I want a StatBroadcast API client for NCAA basketball data, so that I can access real-time play-by-play data for model training and live game monitoring.

#### Acceptance Criteria

1. WHEN initializing the StatBroadcast client THEN the system SHALL establish connection to https://www.statbroadcast.com/events/index.php with proper error handling
2. WHEN searching for schools THEN the system SHALL provide methods to query available NCAA basketball programs and their game schedules
3. WHEN discovering games THEN the system SHALL crawl the site structure to identify active and upcoming games with their unique identifiers
4. WHEN retrieving game data THEN the system SHALL fetch live scoreboard information including current score, time remaining, and possession
5. WHEN parsing play-by-play THEN the system SHALL extract structured data from StatBroadcast's play-by-play format including timestamps, teams, players, and event types
6. WHEN monitoring live games THEN the system SHALL poll for updates at appropriate intervals without overwhelming the StatBroadcast servers
7. WHEN rate limiting occurs THEN the system SHALL implement exponential backoff and respect StatBroadcast's usage policies
8. WHEN connection fails THEN the system SHALL retry with exponential backoff and log detailed error information
9. WHEN data validation fails THEN the system SHALL log warnings and skip malformed play-by-play entries
10. WHEN integrating with existing systems THEN the system SHALL provide normalized data structures compatible with TransitionMatrixBuilder and BayesianTeamStrengthTracker

### Requirement 18

**User Story:** As a developer, I want to retrieve complete game data from StatBroadcast XML archives, so that I can access historical play-by-play and box score data for model training.

#### Acceptance Criteria

1. WHEN fetching archived game data THEN the system SHALL request XML from http://archive.statbroadcast.com/{gameId}.xml
2. WHEN parsing XML game data THEN the system SHALL extract game metadata including teams, date, venue, attendance, and neutral site indicator
3. WHEN parsing XML game data THEN the system SHALL extract team aggregate statistics including field goal percentage, three-point percentage, free throw percentage, rebounds, turnovers, and assists
4. WHEN parsing XML game data THEN the system SHALL extract advanced metrics including points in paint, fast break points, second chance points, and possession count
5. WHEN parsing XML game data THEN the system SHALL extract complete play-by-play sequences with shot types, results, rebounds, turnovers, and game context
6. WHEN parsing XML game data THEN the system SHALL extract player-level statistics for all participants
7. WHEN parsing XML game data THEN the system SHALL extract period-by-period scoring breakdowns
8. WHEN XML parsing fails THEN the system SHALL log detailed error information and skip the malformed game
9. WHEN possession count is available THEN the system SHALL use exact possession data rather than estimation formulas
10. WHEN building transition matrices THEN the system SHALL use XML-derived statistics for accurate probability calculations

### Requirement 19

**User Story:** As a developer, I want to fetch historical game IDs from StatBroadcast team schedules, so that I can retrieve game data for model training.

#### Acceptance Criteria

1. WHEN fetching team schedules THEN the system SHALL query https://www.statbroadcast.com/events/schedule.php?gid={statbroadcast_gid} using the team's GID from the teams table
2. WHEN parsing schedule data THEN the system SHALL extract game IDs from the schedule response
3. WHEN game IDs are extracted THEN the system SHALL use them to construct XML archive URLs: http://archive.statbroadcast.com/{gameId}.xml
4. WHEN fetching multiple teams THEN the system SHALL implement rate limiting to respect StatBroadcast servers
5. WHEN schedule fetching fails THEN the system SHALL log the error and continue with other teams
6. WHEN processing game IDs THEN the system SHALL filter for completed games within the desired date range
7. WHEN caching is needed THEN the system SHALL cache game IDs temporarily in memory to avoid redundant schedule fetches during a single training session

### Requirement 20

**User Story:** As a data scientist, I want to fetch historical games for model training, so that the MLP can learn from past game patterns.

#### Acceptance Criteria

1. WHEN training the MLP THEN the system SHALL fetch game IDs from StatBroadcast schedule endpoints for all teams in the teams table
2. WHEN fetching schedules THEN the system SHALL query https://www.statbroadcast.com/events/schedule.php?gid={statbroadcast_gid} for each team
3. WHEN processing game IDs THEN the system SHALL fetch XML data from http://archive.statbroadcast.com/{gameId}.xml
4. WHEN parsing XML THEN the system SHALL extract play-by-play data and compute transition probabilities on-the-fly
5. WHEN computing team features THEN the system SHALL aggregate statistics across games to build feature vectors
6. WHEN training completes THEN the system SHALL store only the computed feature vectors in teams.statistical_representation field
7. WHEN batch processing THEN the system SHALL implement rate limiting to respect StatBroadcast servers
8. WHEN errors occur THEN the system SHALL log detailed information and continue processing remaining games
9. WHEN re-training is needed THEN the system SHALL re-fetch games from StatBroadcast archives without relying on local storage
10. WHEN displaying training progress THEN the system SHALL show games processed, teams updated, and any errors encountered